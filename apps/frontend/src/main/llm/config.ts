/**
 * LLM Provider Configuration
 * 
 * Types and configuration for multi-LLM fallback system.
 * Enables using alternative LLMs (Ollama, OpenAI, Gemini) when Claude hits rate limits.
 */

/**
 * Supported LLM provider types
 */
export type LLMProviderType = 'claude' | 'ollama' | 'openai' | 'gemini';

/**
 * Status of an LLM provider
 */
export type LLMProviderStatus = 'available' | 'unavailable' | 'rate-limited' | 'error';

/**
 * Message format for LLM conversations
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Options for LLM generation
 */
export interface LLMGenerateOptions {
  /** System prompt/instructions */
  systemPrompt?: string;
  /** Temperature for generation (0-1) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Stop sequences */
  stopSequences?: string[];
  /** Stream the response */
  stream?: boolean;
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Result from LLM generation
 */
export interface LLMGenerateResult {
  /** Generated text content */
  content: string;
  /** Provider that handled the request */
  provider: LLMProviderType;
  /** Model used for generation */
  model: string;
  /** Whether this was a fallback from another provider */
  wasFallback: boolean;
  /** Original provider if this was a fallback */
  originalProvider?: LLMProviderType;
  /** Token usage if available */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  /** Generation duration in ms */
  durationMs: number;
}

/**
 * Configuration for a specific LLM provider
 */
export interface LLMProviderConfig {
  /** Provider type */
  type: LLMProviderType;
  /** Whether this provider is enabled */
  enabled: boolean;
  /** Priority in fallback chain (lower = higher priority) */
  priority: number;
  /** Provider-specific configuration */
  config: OllamaConfig | OpenAIConfig | GeminiConfig | ClaudeConfig;
}

/**
 * Ollama-specific configuration
 */
export interface OllamaConfig {
  /** Base URL for Ollama API (default: http://localhost:11434) */
  baseUrl: string;
  /** Model to use (e.g., 'qwen2.5-coder:7b', 'llama2', 'codellama') */
  model: string;
  /** Connection timeout in ms */
  timeoutMs: number;
  /** Keep model loaded in memory */
  keepAlive?: string;
}

/**
 * OpenAI-specific configuration
 */
export interface OpenAIConfig {
  /** API key (from environment or settings) */
  apiKey?: string;
  /** Model to use (e.g., 'gpt-4', 'gpt-3.5-turbo') */
  model: string;
  /** Organization ID (optional) */
  organization?: string;
  /** Base URL for API (for Azure or proxies) */
  baseUrl?: string;
}

/**
 * Gemini-specific configuration
 */
export interface GeminiConfig {
  /** API key (from environment or settings) */
  apiKey?: string;
  /** Model to use (e.g., 'gemini-pro', 'gemini-1.5-pro') */
  model: string;
}

/**
 * Claude-specific configuration (uses existing Claude Code integration)
 */
export interface ClaudeConfig {
  /** Use the existing Claude profile system */
  useProfileSystem: boolean;
  /** Model preference (opus, sonnet, haiku) */
  model?: string;
}

/**
 * Complete LLM fallback system configuration
 */
export interface LLMFallbackConfig {
  /** List of providers in fallback order */
  providers: LLMProviderConfig[];
  /** Maximum retry attempts per provider */
  maxRetries: number;
  /** Delay between retries (ms) */
  retryDelayMs: number;
  /** Exponential backoff multiplier */
  backoffMultiplier: number;
  /** Whether to auto-switch on rate limit */
  autoSwitchOnRateLimit: boolean;
  /** Cooldown period after rate limit (ms) */
  rateLimitCooldownMs: number;
  /** Enable debug logging */
  debug: boolean;
}

/**
 * Default Ollama configuration
 */
export const DEFAULT_OLLAMA_CONFIG: OllamaConfig = {
  baseUrl: 'http://localhost:11434',
  model: 'qwen2.5-coder:7b',
  timeoutMs: 120000, // 2 minutes for generation
  keepAlive: '5m',
};

/**
 * Default OpenAI configuration
 */
export const DEFAULT_OPENAI_CONFIG: OpenAIConfig = {
  model: 'gpt-4-turbo-preview',
  baseUrl: 'https://api.openai.com/v1',
};

/**
 * Default Gemini configuration
 */
export const DEFAULT_GEMINI_CONFIG: GeminiConfig = {
  model: 'gemini-1.5-pro',
};

/**
 * Default Claude configuration
 */
export const DEFAULT_CLAUDE_CONFIG: ClaudeConfig = {
  useProfileSystem: true,
  model: 'sonnet',
};

/**
 * Default fallback system configuration
 */
export const DEFAULT_FALLBACK_CONFIG: LLMFallbackConfig = {
  providers: [
    {
      type: 'claude',
      enabled: true,
      priority: 1,
      config: DEFAULT_CLAUDE_CONFIG,
    },
    {
      type: 'ollama',
      enabled: true,
      priority: 2,
      config: DEFAULT_OLLAMA_CONFIG,
    },
    {
      type: 'openai',
      enabled: false, // Disabled by default (requires API key)
      priority: 3,
      config: DEFAULT_OPENAI_CONFIG,
    },
    {
      type: 'gemini',
      enabled: false, // Disabled by default (requires API key)
      priority: 4,
      config: DEFAULT_GEMINI_CONFIG,
    },
  ],
  maxRetries: 3,
  retryDelayMs: 1000,
  backoffMultiplier: 2,
  autoSwitchOnRateLimit: true,
  rateLimitCooldownMs: 300000, // 5 minutes
  debug: process.env.DEBUG === 'true',
};

/**
 * Event types emitted by the LLM system
 */
export type LLMEventType =
  | 'provider-switched'
  | 'rate-limit-detected'
  | 'generation-started'
  | 'generation-completed'
  | 'generation-failed'
  | 'provider-status-changed';

/**
 * Event payload for LLM events
 */
export interface LLMEvent {
  type: LLMEventType;
  timestamp: Date;
  provider: LLMProviderType;
  details?: Record<string, unknown>;
}
