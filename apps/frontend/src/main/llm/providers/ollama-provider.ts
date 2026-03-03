/**
 * Ollama LLM Provider
 * 
 * Provider implementation for Ollama, a local LLM runner.
 * Uses the Ollama HTTP API at localhost:11434.
 * 
 * @see https://github.com/ollama/ollama/blob/main/docs/api.md
 */

import { BaseLLMProvider } from './base-provider';
import type {
  LLMProviderType,
  LLMMessage,
  LLMGenerateOptions,
  LLMGenerateResult,
  LLMProviderConfig,
  OllamaConfig,
} from '../config';

/**
 * Ollama API response for /api/generate
 */
interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/**
 * Ollama API response for /api/chat
 */
interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/**
 * Ollama API response for /api/tags (list models)
 */
interface OllamaTagsResponse {
  models: Array<{
    name: string;
    model: string;
    modified_at: string;
    size: number;
    digest: string;
    details?: {
      parent_model?: string;
      format?: string;
      family?: string;
      families?: string[];
      parameter_size?: string;
      quantization_level?: string;
    };
  }>;
}

/**
 * Ollama LLM Provider
 * 
 * Connects to a local Ollama instance for LLM inference.
 * Great fallback option when Claude is rate limited.
 */
export class OllamaProvider extends BaseLLMProvider {
  private ollamaConfig: OllamaConfig;
  private availableModels: string[] = [];

  constructor(config: LLMProviderConfig) {
    super(config);
    this.ollamaConfig = config.config as OllamaConfig;
  }

  getName(): LLMProviderType {
    return 'ollama';
  }

  getDisplayName(): string {
    return `Ollama (${this.ollamaConfig.model})`;
  }

  getModel(): string {
    return this.ollamaConfig.model;
  }

  /**
   * Check if Ollama is running and the model is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Check if Ollama is running
      const response = await this.fetchWithTimeout(
        `${this.ollamaConfig.baseUrl}/api/tags`,
        { method: 'GET' },
        5000 // 5 second timeout for health check
      );

      if (!response.ok) {
        this.setStatus('unavailable');
        return false;
      }

      const data = await response.json() as OllamaTagsResponse;
      this.availableModels = data.models?.map(m => m.name) || [];

      // Check if the configured model is available
      const modelAvailable = this.availableModels.some(
        m => m === this.ollamaConfig.model || 
             m.startsWith(`${this.ollamaConfig.model}:`) ||
             m === `${this.ollamaConfig.model}:latest`
      );

      if (!modelAvailable) {
        this.logWarn(`Model ${this.ollamaConfig.model} not found. Available:`, this.availableModels);
        this.setStatus('unavailable');
        return false;
      }

      this.setStatus('available');
      return true;
    } catch (error) {
      this.logError('Failed to connect to Ollama', error);
      this.setStatus('unavailable');
      return false;
    }
  }

  /**
   * List available models in Ollama
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.ollamaConfig.baseUrl}/api/tags`,
        { method: 'GET' },
        5000
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as OllamaTagsResponse;
      return data.models?.map(m => m.name) || [];
    } catch {
      return [];
    }
  }

  /**
   * Generate text using Ollama's chat API
   */
  async generate(
    messages: LLMMessage[],
    options?: LLMGenerateOptions
  ): Promise<LLMGenerateResult> {
    const startTime = Date.now();

    try {
      // Format messages for Ollama
      const ollamaMessages = this.formatMessages(messages, options);

      this.log('Generating with messages:', {
        messageCount: ollamaMessages.length,
        model: this.ollamaConfig.model,
      });

      const requestBody = {
        model: this.ollamaConfig.model,
        messages: ollamaMessages,
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.7,
          num_predict: options?.maxTokens ?? 4096,
          stop: options?.stopSequences,
        },
        keep_alive: this.ollamaConfig.keepAlive,
      };

      const response = await this.fetchWithTimeout(
        `${this.ollamaConfig.baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        },
        options?.timeoutMs ?? this.ollamaConfig.timeoutMs
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as OllamaChatResponse;
      const durationMs = Date.now() - startTime;

      this.log('Generation completed', {
        durationMs,
        totalDuration: data.total_duration,
        evalCount: data.eval_count,
      });

      return this.createResult(
        data.message.content,
        data.model,
        durationMs,
        {
          usage: {
            promptTokens: data.prompt_eval_count,
            completionTokens: data.eval_count,
            totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
          },
        }
      );
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logError(`Generation failed after ${durationMs}ms`, error);
      this.recordError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Alternative: Use /api/generate for simpler text generation
   */
  async generateSimple(
    prompt: string,
    options?: LLMGenerateOptions
  ): Promise<LLMGenerateResult> {
    const startTime = Date.now();

    try {
      this.log('Simple generation with prompt length:', prompt.length);

      const requestBody = {
        model: this.ollamaConfig.model,
        prompt,
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.7,
          num_predict: options?.maxTokens ?? 4096,
          stop: options?.stopSequences,
        },
        keep_alive: this.ollamaConfig.keepAlive,
      };

      const response = await this.fetchWithTimeout(
        `${this.ollamaConfig.baseUrl}/api/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        },
        options?.timeoutMs ?? this.ollamaConfig.timeoutMs
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as OllamaGenerateResponse;
      const durationMs = Date.now() - startTime;

      return this.createResult(
        data.response,
        data.model,
        durationMs,
        {
          usage: {
            promptTokens: data.prompt_eval_count,
            completionTokens: data.eval_count,
            totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
          },
        }
      );
    } catch (error) {
      this.recordError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Pull a model from Ollama registry
   */
  async pullModel(modelName: string): Promise<void> {
    this.log(`Pulling model: ${modelName}`);

    const response = await this.fetchWithTimeout(
      `${this.ollamaConfig.baseUrl}/api/pull`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: false }),
      },
      300000 // 5 minute timeout for model download
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to pull model (${response.status}): ${errorText}`);
    }

    this.log(`Model ${modelName} pulled successfully`);
  }

  /**
   * Format messages for Ollama's chat API
   */
  private formatMessages(
    messages: LLMMessage[],
    options?: LLMGenerateOptions
  ): Array<{ role: string; content: string }> {
    const result: Array<{ role: string; content: string }> = [];

    // Add system prompt if provided
    if (options?.systemPrompt) {
      result.push({
        role: 'system',
        content: options.systemPrompt,
      });
    }

    // Convert messages
    for (const msg of messages) {
      result.push({
        role: msg.role,
        content: msg.content,
      });
    }

    return result;
  }

  /**
   * Fetch with timeout support
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
