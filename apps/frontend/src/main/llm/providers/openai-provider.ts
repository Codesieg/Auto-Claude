/**
 * OpenAI LLM Provider (Stub)
 * 
 * Placeholder implementation for OpenAI integration.
 * To enable, add your API key and set enabled: true in config.
 * 
 * Full implementation would use the OpenAI Node.js SDK:
 * npm install openai
 */

import { BaseLLMProvider } from './base-provider';
import type {
  LLMProviderType,
  LLMMessage,
  LLMGenerateOptions,
  LLMGenerateResult,
  LLMProviderConfig,
  OpenAIConfig,
} from '../config';

/**
 * OpenAI API response format
 */
interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenAI LLM Provider
 * 
 * Provides fallback to OpenAI GPT models when Claude is unavailable.
 * Requires OPENAI_API_KEY environment variable or config.
 */
export class OpenAIProvider extends BaseLLMProvider {
  private openaiConfig: OpenAIConfig;

  constructor(config: LLMProviderConfig) {
    super(config);
    this.openaiConfig = config.config as OpenAIConfig;
  }

  getName(): LLMProviderType {
    return 'openai';
  }

  getDisplayName(): string {
    return `OpenAI (${this.openaiConfig.model})`;
  }

  getModel(): string {
    return this.openaiConfig.model;
  }

  /**
   * Check if OpenAI is available (has API key and can connect)
   */
  async isAvailable(): Promise<boolean> {
    const apiKey = this.getApiKey();
    
    if (!apiKey) {
      this.logWarn('OpenAI API key not configured');
      this.setStatus('unavailable');
      return false;
    }

    try {
      // Simple check - verify the API key works by listing models
      const response = await this.fetchWithTimeout(
        `${this.openaiConfig.baseUrl || 'https://api.openai.com/v1'}/models`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        },
        5000
      );

      if (!response.ok) {
        if (response.status === 401) {
          this.logWarn('OpenAI API key invalid');
          this.setStatus('unavailable');
          return false;
        }
        if (response.status === 429) {
          this.logWarn('OpenAI rate limited');
          this.markRateLimited();
          return false;
        }
        this.setStatus('error');
        return false;
      }

      this.setStatus('available');
      return true;
    } catch (error) {
      this.logError('Failed to connect to OpenAI', error);
      this.setStatus('unavailable');
      return false;
    }
  }

  /**
   * Generate text using OpenAI's chat API
   */
  async generate(
    messages: LLMMessage[],
    options?: LLMGenerateOptions
  ): Promise<LLMGenerateResult> {
    const startTime = Date.now();
    const apiKey = this.getApiKey();

    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    try {
      const openaiMessages = this.formatMessages(messages, options);

      this.log('Generating with messages:', {
        messageCount: openaiMessages.length,
        model: this.openaiConfig.model,
      });

      const requestBody = {
        model: this.openaiConfig.model,
        messages: openaiMessages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
        stop: options?.stopSequences,
      };

      const response = await this.fetchWithTimeout(
        `${this.openaiConfig.baseUrl || 'https://api.openai.com/v1'}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...(this.openaiConfig.organization && {
              'OpenAI-Organization': this.openaiConfig.organization,
            }),
          },
          body: JSON.stringify(requestBody),
        },
        options?.timeoutMs ?? 120000
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        // Check for rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const resetTime = retryAfter ? new Date(Date.now() + parseInt(retryAfter) * 1000) : undefined;
          this.markRateLimited(resetTime);
          throw new Error(`OpenAI rate limited${retryAfter ? ` (retry after ${retryAfter}s)` : ''}`);
        }

        throw new Error(`OpenAI API error (${response.status}): ${JSON.stringify(errorData)}`);
      }

      const data = await response.json() as OpenAIResponse;
      const durationMs = Date.now() - startTime;

      const content = data.choices[0]?.message?.content || '';

      this.log('Generation completed', {
        durationMs,
        usage: data.usage,
      });

      return this.createResult(
        content,
        data.model,
        durationMs,
        {
          usage: {
            promptTokens: data.usage?.prompt_tokens,
            completionTokens: data.usage?.completion_tokens,
            totalTokens: data.usage?.total_tokens,
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
   * Get API key from config or environment
   */
  private getApiKey(): string | undefined {
    return this.openaiConfig.apiKey || process.env.OPENAI_API_KEY;
  }

  /**
   * Format messages for OpenAI's chat API
   */
  private formatMessages(
    messages: LLMMessage[],
    options?: LLMGenerateOptions
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const result: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

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
