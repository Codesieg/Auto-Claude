/**
 * Multi-LLM Fallback System
 * 
 * Provides automatic failover between multiple LLM providers when
 * the primary provider (Claude) is rate limited or unavailable.
 * 
 * @example
 * ```typescript
 * import { getFallbackManager, LLMMessage } from './llm';
 * 
 * const manager = getFallbackManager();
 * await manager.initialize();
 * 
 * const messages: LLMMessage[] = [
 *   { role: 'user', content: 'Hello, can you help me?' }
 * ];
 * 
 * const result = await manager.generate(messages, {
 *   systemPrompt: 'You are a helpful assistant.',
 *   temperature: 0.7,
 * });
 * 
 * console.log(`Response from ${result.provider}:`, result.content);
 * if (result.wasFallback) {
 *   console.log(`Fell back from ${result.originalProvider}`);
 * }
 * ```
 */

// Configuration and types
export {
  type LLMProviderType,
  type LLMProviderStatus,
  type LLMMessage,
  type LLMGenerateOptions,
  type LLMGenerateResult,
  type LLMProviderConfig,
  type LLMFallbackConfig,
  type LLMEvent,
  type LLMEventType,
  type OllamaConfig,
  type OpenAIConfig,
  type GeminiConfig,
  type ClaudeConfig,
  DEFAULT_FALLBACK_CONFIG,
  DEFAULT_OLLAMA_CONFIG,
  DEFAULT_OPENAI_CONFIG,
  DEFAULT_GEMINI_CONFIG,
  DEFAULT_CLAUDE_CONFIG,
} from './config';

// Base provider
export { BaseLLMProvider, type LLMProviderFactory } from './providers/base-provider';

// Provider implementations
export { ClaudeProvider } from './providers/claude-provider';
export { OllamaProvider } from './providers/ollama-provider';
export { OpenAIProvider } from './providers/openai-provider';
export { GeminiProvider } from './providers/gemini-provider';

// Fallback manager
export {
  LLMFallbackManager,
  getFallbackManager,
  initializeFallbackManager,
} from './fallback-manager';

// Rate limit detection
export {
  detectRateLimitMulti,
  detectAuthFailureMulti,
  detectConnectionError,
  classifyError,
  type MultiLLMRateLimitResult,
  type ErrorType,
  type ErrorClassification,
} from './rate-limit-detector';
