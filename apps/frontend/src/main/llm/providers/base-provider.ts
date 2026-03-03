/**
 * Base LLM Provider Interface
 * 
 * Abstract interface that all LLM providers must implement.
 * Provides a unified API for text generation across different LLM backends.
 */

import type {
  LLMProviderType,
  LLMProviderStatus,
  LLMMessage,
  LLMGenerateOptions,
  LLMGenerateResult,
  LLMProviderConfig,
} from '../config';

/**
 * Abstract base class for LLM providers.
 * 
 * Each provider implementation must handle:
 * - Connection/initialization
 * - Health checks
 * - Text generation
 * - Error handling and rate limit detection
 */
export abstract class BaseLLMProvider {
  protected config: LLMProviderConfig;
  protected status: LLMProviderStatus = 'unavailable';
  protected lastError: Error | null = null;
  protected lastRateLimitTime: Date | null = null;
  protected rateLimitResetTime: Date | null = null;

  constructor(config: LLMProviderConfig) {
    this.config = config;
  }

  /**
   * Get the provider type identifier
   */
  abstract getName(): LLMProviderType;

  /**
   * Get a human-readable display name for the provider
   */
  abstract getDisplayName(): string;

  /**
   * Get the model being used
   */
  abstract getModel(): string;

  /**
   * Check if the provider is currently available
   * This should perform a lightweight health check
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Generate text based on messages
   * 
   * @param messages - Conversation messages
   * @param options - Generation options
   * @returns Generation result
   * @throws Error if generation fails
   */
  abstract generate(
    messages: LLMMessage[],
    options?: LLMGenerateOptions
  ): Promise<LLMGenerateResult>;

  /**
   * Initialize the provider (optional)
   * Called once when the provider is first used
   */
  async initialize(): Promise<void> {
    // Default: no-op
  }

  /**
   * Cleanup resources (optional)
   * Called when the provider is being shut down
   */
  async dispose(): Promise<void> {
    // Default: no-op
  }

  /**
   * Get the current provider status
   */
  getStatus(): LLMProviderStatus {
    return this.status;
  }

  /**
   * Set the provider status
   */
  protected setStatus(status: LLMProviderStatus): void {
    this.status = status;
    this.log(`Status changed to: ${status}`);
  }

  /**
   * Get the last error that occurred
   */
  getLastError(): Error | null {
    return this.lastError;
  }

  /**
   * Get the provider priority (lower = higher priority)
   */
  getPriority(): number {
    return this.config.priority;
  }

  /**
   * Check if the provider is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Check if the provider is currently rate limited
   */
  isRateLimited(): boolean {
    if (!this.lastRateLimitTime) {
      return false;
    }

    // If we have a reset time, use it
    if (this.rateLimitResetTime) {
      return new Date() < this.rateLimitResetTime;
    }

    // Default: consider rate limited for 5 minutes
    const cooldownMs = 5 * 60 * 1000;
    const timeSinceLimit = Date.now() - this.lastRateLimitTime.getTime();
    return timeSinceLimit < cooldownMs;
  }

  /**
   * Get the rate limit reset time if available
   */
  getRateLimitResetTime(): Date | null {
    return this.rateLimitResetTime;
  }

  /**
   * Mark the provider as rate limited
   */
  markRateLimited(resetTime?: Date): void {
    this.lastRateLimitTime = new Date();
    this.rateLimitResetTime = resetTime || null;
    this.setStatus('rate-limited');
    this.log(`Rate limited${resetTime ? ` until ${resetTime.toISOString()}` : ''}`);
  }

  /**
   * Clear rate limit status
   */
  clearRateLimit(): void {
    this.lastRateLimitTime = null;
    this.rateLimitResetTime = null;
    if (this.status === 'rate-limited') {
      this.setStatus('available');
    }
  }

  /**
   * Record an error
   */
  protected recordError(error: Error): void {
    this.lastError = error;
    this.setStatus('error');
    this.logError('Error occurred', error);
  }

  /**
   * Log a message with provider prefix
   */
  protected log(message: string, data?: unknown): void {
    const prefix = `[LLM:${this.getName()}]`;
    if (data !== undefined) {
      console.log(prefix, message, data);
    } else {
      console.log(prefix, message);
    }
  }

  /**
   * Log an error with provider prefix
   */
  protected logError(message: string, error?: unknown): void {
    const prefix = `[LLM:${this.getName()}]`;
    console.error(prefix, message, error);
  }

  /**
   * Log a warning with provider prefix
   */
  protected logWarn(message: string, data?: unknown): void {
    const prefix = `[LLM:${this.getName()}]`;
    if (data !== undefined) {
      console.warn(prefix, message, data);
    } else {
      console.warn(prefix, message);
    }
  }

  /**
   * Create a standard generate result
   */
  protected createResult(
    content: string,
    model: string,
    durationMs: number,
    options?: {
      wasFallback?: boolean;
      originalProvider?: LLMProviderType;
      usage?: LLMGenerateResult['usage'];
    }
  ): LLMGenerateResult {
    return {
      content,
      provider: this.getName(),
      model,
      wasFallback: options?.wasFallback || false,
      originalProvider: options?.originalProvider,
      usage: options?.usage,
      durationMs,
    };
  }

  /**
   * Build the full prompt from messages
   */
  protected buildPrompt(
    messages: LLMMessage[],
    options?: LLMGenerateOptions
  ): string {
    const parts: string[] = [];

    // Add system prompt first if provided
    if (options?.systemPrompt) {
      parts.push(`System: ${options.systemPrompt}`);
    }

    // Add messages
    for (const msg of messages) {
      if (msg.role === 'system') {
        parts.push(`System: ${msg.content}`);
      } else if (msg.role === 'user') {
        parts.push(`User: ${msg.content}`);
      } else if (msg.role === 'assistant') {
        parts.push(`Assistant: ${msg.content}`);
      }
    }

    return parts.join('\n\n');
  }
}

/**
 * Factory type for creating providers
 */
export type LLMProviderFactory = (config: LLMProviderConfig) => BaseLLMProvider;
