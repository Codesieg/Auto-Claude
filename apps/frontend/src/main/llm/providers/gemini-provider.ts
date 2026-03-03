/**
 * Google Gemini LLM Provider (Stub)
 * 
 * Placeholder implementation for Google Gemini integration.
 * To enable, add your API key and set enabled: true in config.
 * 
 * Full implementation would use the Google AI SDK:
 * npm install @google/generative-ai
 */

import { BaseLLMProvider } from './base-provider';
import type {
  LLMProviderType,
  LLMMessage,
  LLMGenerateOptions,
  LLMGenerateResult,
  LLMProviderConfig,
  GeminiConfig,
} from '../config';

/**
 * Gemini API response format
 */
interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
      role: string;
    };
    finishReason: string;
    index: number;
    safetyRatings: Array<{
      category: string;
      probability: string;
    }>;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

/**
 * Gemini LLM Provider
 * 
 * Provides fallback to Google Gemini models when Claude is unavailable.
 * Requires GEMINI_API_KEY or GOOGLE_API_KEY environment variable or config.
 */
export class GeminiProvider extends BaseLLMProvider {
  private geminiConfig: GeminiConfig;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  constructor(config: LLMProviderConfig) {
    super(config);
    this.geminiConfig = config.config as GeminiConfig;
  }

  getName(): LLMProviderType {
    return 'gemini';
  }

  getDisplayName(): string {
    return `Gemini (${this.geminiConfig.model})`;
  }

  getModel(): string {
    return this.geminiConfig.model;
  }

  /**
   * Check if Gemini is available (has API key and can connect)
   */
  async isAvailable(): Promise<boolean> {
    const apiKey = this.getApiKey();
    
    if (!apiKey) {
      this.logWarn('Gemini API key not configured');
      this.setStatus('unavailable');
      return false;
    }

    try {
      // Check by listing models
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/models?key=${apiKey}`,
        { method: 'GET' },
        5000
      );

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          this.logWarn('Gemini API key invalid');
          this.setStatus('unavailable');
          return false;
        }
        if (response.status === 429) {
          this.logWarn('Gemini rate limited');
          this.markRateLimited();
          return false;
        }
        this.setStatus('error');
        return false;
      }

      this.setStatus('available');
      return true;
    } catch (error) {
      this.logError('Failed to connect to Gemini', error);
      this.setStatus('unavailable');
      return false;
    }
  }

  /**
   * Generate text using Gemini's generateContent API
   */
  async generate(
    messages: LLMMessage[],
    options?: LLMGenerateOptions
  ): Promise<LLMGenerateResult> {
    const startTime = Date.now();
    const apiKey = this.getApiKey();

    if (!apiKey) {
      throw new Error('Gemini API key not configured');
    }

    try {
      const geminiContents = this.formatMessages(messages, options);

      this.log('Generating with messages:', {
        messageCount: geminiContents.length,
        model: this.geminiConfig.model,
      });

      const requestBody = {
        contents: geminiContents,
        generationConfig: {
          temperature: options?.temperature ?? 0.7,
          maxOutputTokens: options?.maxTokens ?? 4096,
          stopSequences: options?.stopSequences,
        },
      };

      const model = this.geminiConfig.model;
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        },
        options?.timeoutMs ?? 120000
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        // Check for rate limiting
        if (response.status === 429) {
          this.markRateLimited();
          throw new Error('Gemini rate limited');
        }

        throw new Error(`Gemini API error (${response.status}): ${JSON.stringify(errorData)}`);
      }

      const data = await response.json() as GeminiResponse;
      const durationMs = Date.now() - startTime;

      // Extract content from response
      const content = data.candidates?.[0]?.content?.parts
        ?.map(p => p.text)
        .join('') || '';

      this.log('Generation completed', {
        durationMs,
        usage: data.usageMetadata,
      });

      return this.createResult(
        content,
        model,
        durationMs,
        {
          usage: {
            promptTokens: data.usageMetadata?.promptTokenCount,
            completionTokens: data.usageMetadata?.candidatesTokenCount,
            totalTokens: data.usageMetadata?.totalTokenCount,
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
    return this.geminiConfig.apiKey || 
           process.env.GEMINI_API_KEY || 
           process.env.GOOGLE_API_KEY;
  }

  /**
   * Format messages for Gemini's API
   * Gemini uses "user" and "model" roles
   */
  private formatMessages(
    messages: LLMMessage[],
    options?: LLMGenerateOptions
  ): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
    const result: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    // Gemini doesn't have a system role - prepend to first user message
    let systemPrefix = options?.systemPrompt || '';
    
    // Find any system messages and prepend them
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrefix = systemPrefix ? `${systemPrefix}\n\n${msg.content}` : msg.content;
      }
    }

    // Convert messages
    for (const msg of messages) {
      if (msg.role === 'system') continue; // Already handled

      const role = msg.role === 'assistant' ? 'model' : 'user';
      let content = msg.content;

      // Prepend system prompt to first user message
      if (role === 'user' && systemPrefix && result.length === 0) {
        content = `${systemPrefix}\n\n${content}`;
        systemPrefix = ''; // Only add once
      }

      result.push({
        role,
        parts: [{ text: content }],
      });
    }

    // If no messages but we have system prompt, create a user message
    if (result.length === 0 && systemPrefix) {
      result.push({
        role: 'user',
        parts: [{ text: systemPrefix }],
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
