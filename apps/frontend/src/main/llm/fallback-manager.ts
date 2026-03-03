/**
 * LLM Fallback Manager
 * 
 * Manages the chain of LLM providers and handles automatic fallback
 * when providers fail or are rate limited.
 * 
 * Features:
 * - Priority-based provider selection
 * - Automatic retry with exponential backoff
 * - Rate limit detection and provider switching
 * - Event emission for UI updates
 */

import { EventEmitter } from 'events';
import type {
  LLMProviderType,
  LLMFallbackConfig,
  LLMProviderConfig,
  LLMMessage,
  LLMGenerateOptions,
  LLMGenerateResult,
  LLMEvent,
  LLMEventType,
} from './config';
import { DEFAULT_FALLBACK_CONFIG } from './config';
import { BaseLLMProvider } from './providers/base-provider';
import { ClaudeProvider } from './providers/claude-provider';
import { OllamaProvider } from './providers/ollama-provider';
import { OpenAIProvider } from './providers/openai-provider';
import { GeminiProvider } from './providers/gemini-provider';
import { classifyError, type ErrorClassification } from './rate-limit-detector';

/**
 * Provider creation functions
 */
const PROVIDER_FACTORIES: Record<LLMProviderType, (config: LLMProviderConfig) => BaseLLMProvider> = {
  claude: (config) => new ClaudeProvider(config),
  ollama: (config) => new OllamaProvider(config),
  openai: (config) => new OpenAIProvider(config),
  gemini: (config) => new GeminiProvider(config),
};

/**
 * LLM Fallback Manager
 * 
 * Orchestrates multiple LLM providers and handles failover between them.
 */
export class LLMFallbackManager extends EventEmitter {
  private config: LLMFallbackConfig;
  private providers: Map<LLMProviderType, BaseLLMProvider> = new Map();
  private providerOrder: LLMProviderType[] = [];
  private currentProvider: LLMProviderType | null = null;
  private isInitialized = false;

  constructor(config?: Partial<LLMFallbackConfig>) {
    super();
    this.config = { ...DEFAULT_FALLBACK_CONFIG, ...config };
    this.initializeProviders();
  }

  /**
   * Initialize providers based on configuration
   */
  private initializeProviders(): void {
    // Sort providers by priority
    const sortedConfigs = [...this.config.providers]
      .filter(p => p.enabled)
      .sort((a, b) => a.priority - b.priority);

    this.providerOrder = [];

    for (const providerConfig of sortedConfigs) {
      const factory = PROVIDER_FACTORIES[providerConfig.type];
      if (factory) {
        const provider = factory(providerConfig);
        this.providers.set(providerConfig.type, provider);
        this.providerOrder.push(providerConfig.type);
        this.log(`Initialized provider: ${providerConfig.type} (priority: ${providerConfig.priority})`);
      }
    }

    if (this.providerOrder.length > 0) {
      this.currentProvider = this.providerOrder[0];
    }
  }

  /**
   * Initialize the fallback system (check provider availability)
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.log('Initializing fallback system...');

    // Initialize all providers
    for (const [type, provider] of this.providers) {
      try {
        await provider.initialize();
      } catch (error) {
        this.logError(`Failed to initialize ${type}`, error);
      }
    }

    // Check availability of each provider
    await this.checkAllProviders();

    this.isInitialized = true;
    this.log('Fallback system initialized');
  }

  /**
   * Check availability of all providers
   */
  async checkAllProviders(): Promise<Map<LLMProviderType, boolean>> {
    const results = new Map<LLMProviderType, boolean>();

    for (const [type, provider] of this.providers) {
      try {
        const available = await provider.isAvailable();
        results.set(type, available);
        this.log(`Provider ${type}: ${available ? 'available' : 'unavailable'}`);
      } catch (error) {
        results.set(type, false);
        this.logError(`Error checking ${type}`, error);
      }
    }

    return results;
  }

  /**
   * Get the current active provider
   */
  getCurrentProvider(): BaseLLMProvider | null {
    if (!this.currentProvider) return null;
    return this.providers.get(this.currentProvider) || null;
  }

  /**
   * Get provider by type
   */
  getProvider(type: LLMProviderType): BaseLLMProvider | null {
    return this.providers.get(type) || null;
  }

  /**
   * Generate text with automatic fallback
   */
  async generate(
    messages: LLMMessage[],
    options?: LLMGenerateOptions
  ): Promise<LLMGenerateResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const startProvider = this.currentProvider;
    let lastError: Error | null = null;
    let attemptedProviders: LLMProviderType[] = [];

    // Try each provider in order
    for (const providerType of this.providerOrder) {
      const provider = this.providers.get(providerType);
      if (!provider) continue;

      // Skip if already rate limited
      if (provider.isRateLimited()) {
        this.log(`Skipping ${providerType} (rate limited)`);
        continue;
      }

      attemptedProviders.push(providerType);

      try {
        // Check availability
        const available = await provider.isAvailable();
        if (!available) {
          this.log(`Skipping ${providerType} (unavailable)`);
          continue;
        }

        // Emit event
        this.emitEvent('generation-started', providerType, {
          messageCount: messages.length,
          isFallback: providerType !== startProvider,
        });

        // Try to generate with retries
        const result = await this.generateWithRetry(provider, messages, options);

        // Mark as fallback if we switched providers
        if (providerType !== startProvider && startProvider) {
          result.wasFallback = true;
          result.originalProvider = startProvider;
          
          this.emitEvent('provider-switched', providerType, {
            from: startProvider,
            to: providerType,
          });
        }

        // Update current provider
        this.currentProvider = providerType;

        this.emitEvent('generation-completed', providerType, {
          durationMs: result.durationMs,
          wasFallback: result.wasFallback,
        });

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Classify the error
        const classification = classifyError(lastError, providerType);
        this.log(`Error from ${providerType}:`, classification);

        // Handle based on error type
        if (classification.type === 'rate-limit') {
          provider.markRateLimited();
          this.emitEvent('rate-limit-detected', providerType, {
            suggestedWaitMs: classification.suggestedWaitMs,
          });
        }

        this.emitEvent('generation-failed', providerType, {
          error: lastError.message,
          classification,
          willFallback: classification.shouldFallback,
        });

        // If we shouldn't fallback, throw immediately
        if (!classification.shouldFallback) {
          throw lastError;
        }

        // Continue to next provider
      }
    }

    // All providers failed
    const error = new Error(
      `All LLM providers failed. Attempted: ${attemptedProviders.join(', ')}. ` +
      `Last error: ${lastError?.message || 'Unknown'}`
    );
    throw error;
  }

  /**
   * Generate with retry logic
   */
  private async generateWithRetry(
    provider: BaseLLMProvider,
    messages: LLMMessage[],
    options?: LLMGenerateOptions
  ): Promise<LLMGenerateResult> {
    let lastError: Error | null = null;
    let delay = this.config.retryDelayMs;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        return await provider.generate(messages, options);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Classify error
        const classification = classifyError(lastError, provider.getName());
        
        // Don't retry rate limits or auth failures
        if (!classification.shouldRetry) {
          throw lastError;
        }

        // Check if we should retry
        if (attempt < this.config.maxRetries - 1) {
          this.log(`Retry ${attempt + 1}/${this.config.maxRetries} for ${provider.getName()} after ${delay}ms`);
          await this.sleep(delay);
          delay *= this.config.backoffMultiplier;
        }
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Force switch to a specific provider
   */
  async switchProvider(providerType: LLMProviderType): Promise<boolean> {
    const provider = this.providers.get(providerType);
    if (!provider) {
      this.logError(`Provider ${providerType} not found`);
      return false;
    }

    const available = await provider.isAvailable();
    if (!available) {
      this.logError(`Provider ${providerType} not available`);
      return false;
    }

    const previousProvider = this.currentProvider;
    this.currentProvider = providerType;

    this.emitEvent('provider-switched', providerType, {
      from: previousProvider,
      to: providerType,
      manual: true,
    });

    return true;
  }

  /**
   * Get the next available provider
   */
  async getNextAvailableProvider(skipCurrent = true): Promise<LLMProviderType | null> {
    const startIndex = skipCurrent && this.currentProvider
      ? this.providerOrder.indexOf(this.currentProvider) + 1
      : 0;

    for (let i = startIndex; i < this.providerOrder.length; i++) {
      const providerType = this.providerOrder[i];
      const provider = this.providers.get(providerType);

      if (provider && !provider.isRateLimited()) {
        const available = await provider.isAvailable();
        if (available) {
          return providerType;
        }
      }
    }

    return null;
  }

  /**
   * Get status of all providers
   */
  getProviderStatuses(): Array<{
    type: LLMProviderType;
    status: string;
    isRateLimited: boolean;
    isCurrent: boolean;
    priority: number;
  }> {
    return this.providerOrder.map(type => {
      const provider = this.providers.get(type)!;
      return {
        type,
        status: provider.getStatus(),
        isRateLimited: provider.isRateLimited(),
        isCurrent: type === this.currentProvider,
        priority: provider.getPriority(),
      };
    });
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<LLMFallbackConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Re-initialize providers if provider config changed
    if (config.providers) {
      this.providers.clear();
      this.initializeProviders();
      this.isInitialized = false;
    }
  }

  /**
   * Clear rate limit status for a provider
   */
  clearRateLimit(providerType: LLMProviderType): void {
    const provider = this.providers.get(providerType);
    if (provider) {
      provider.clearRateLimit();
      this.emitEvent('provider-status-changed', providerType, {
        previousStatus: 'rate-limited',
        newStatus: 'available',
      });
    }
  }

  /**
   * Dispose of all providers
   */
  async dispose(): Promise<void> {
    for (const provider of this.providers.values()) {
      try {
        await provider.dispose();
      } catch (error) {
        this.logError('Error disposing provider', error);
      }
    }
    this.providers.clear();
    this.providerOrder = [];
    this.currentProvider = null;
    this.isInitialized = false;
  }

  /**
   * Emit an LLM event
   */
  private emitEvent(
    type: LLMEventType,
    provider: LLMProviderType,
    details?: Record<string, unknown>
  ): void {
    const event: LLMEvent = {
      type,
      timestamp: new Date(),
      provider,
      details,
    };
    this.emit('llm-event', event);
    this.emit(type, event);

    if (this.config.debug) {
      this.log(`Event: ${type}`, details);
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Log message
   */
  private log(message: string, data?: unknown): void {
    const prefix = '[LLM:FallbackManager]';
    if (data !== undefined) {
      console.log(prefix, message, data);
    } else {
      console.log(prefix, message);
    }
  }

  /**
   * Log error
   */
  private logError(message: string, error?: unknown): void {
    console.error('[LLM:FallbackManager]', message, error);
  }
}

// Singleton instance
let fallbackManagerInstance: LLMFallbackManager | null = null;

/**
 * Get the singleton fallback manager instance
 */
export function getFallbackManager(): LLMFallbackManager {
  if (!fallbackManagerInstance) {
    fallbackManagerInstance = new LLMFallbackManager();
  }
  return fallbackManagerInstance;
}

/**
 * Initialize the fallback manager with custom config
 */
export function initializeFallbackManager(config?: Partial<LLMFallbackConfig>): LLMFallbackManager {
  if (fallbackManagerInstance) {
    fallbackManagerInstance.dispose();
  }
  fallbackManagerInstance = new LLMFallbackManager(config);
  return fallbackManagerInstance;
}
