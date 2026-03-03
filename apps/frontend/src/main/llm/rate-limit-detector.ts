/**
 * Multi-LLM Rate Limit Detector
 * 
 * Extends rate limit detection for the multi-LLM fallback system.
 * Integrates with the existing Claude rate limit detector and adds
 * patterns for other providers.
 */

import type { LLMProviderType } from './config';

// Import existing Claude rate limit detector
import {
  detectRateLimit as detectClaudeRateLimit,
  detectAuthFailure as detectClaudeAuthFailure,
  type RateLimitDetectionResult,
  type AuthFailureDetectionResult,
} from '../rate-limit-detector';

/**
 * Extended rate limit result with provider info
 */
export interface MultiLLMRateLimitResult extends RateLimitDetectionResult {
  /** Provider that was rate limited */
  provider: LLMProviderType;
  /** Whether we should try fallback */
  shouldFallback: boolean;
  /** Suggested wait time in ms */
  suggestedWaitMs?: number;
}

/**
 * Rate limit patterns for different providers
 */
const RATE_LIMIT_PATTERNS: Record<LLMProviderType, RegExp[]> = {
  claude: [
    /Limit reached\s*[·•]\s*resets\s+(.+?)(?:\s*$|\n)/im,
    /rate\s*limit/i,
    /usage\s*limit/i,
    /limit\s*reached/i,
    /exceeded.*limit/i,
    /too\s*many\s*requests/i,
  ],
  ollama: [
    /model is currently at capacity/i,
    /server is busy/i,
    /too many requests/i,
    /503\s*service\s*unavailable/i,
  ],
  openai: [
    /rate_limit_exceeded/i,
    /too many requests/i,
    /429/,
    /quota_exceeded/i,
    /billing_hard_limit_reached/i,
    /insufficient_quota/i,
  ],
  gemini: [
    /resource_exhausted/i,
    /quota exceeded/i,
    /rate limit/i,
    /429/,
  ],
};

/**
 * Error patterns that indicate auth failure (not rate limit)
 */
const AUTH_FAILURE_PATTERNS: Record<LLMProviderType, RegExp[]> = {
  claude: [
    /authentication\s*(is\s*)?required/i,
    /not\s*(yet\s*)?authenticated/i,
    /invalid\s*(credentials|token|api\s*key)/i,
    /401\s*unauthorized/i,
  ],
  ollama: [
    // Ollama typically doesn't require auth
  ],
  openai: [
    /invalid_api_key/i,
    /incorrect_api_key/i,
    /invalid api key/i,
    /authentication/i,
    /401/,
  ],
  gemini: [
    /api_key_invalid/i,
    /invalid.*api.*key/i,
    /permission_denied/i,
    /401/,
    /403/,
  ],
};

/**
 * Connection error patterns
 */
const CONNECTION_ERROR_PATTERNS: Record<LLMProviderType, RegExp[]> = {
  claude: [
    /connection\s*(refused|reset|timed?\s*out)/i,
    /network\s*(error|unavailable)/i,
    /ECONNREFUSED/i,
    /ETIMEDOUT/i,
  ],
  ollama: [
    /connect ECONNREFUSED/i,
    /connection refused/i,
    /no such host/i,
    /getaddrinfo ENOTFOUND/i,
    /ECONNRESET/i,
    /socket hang up/i,
  ],
  openai: [
    /connection\s*(refused|reset|timed?\s*out)/i,
    /network\s*error/i,
    /ECONNREFUSED/i,
  ],
  gemini: [
    /connection\s*(refused|reset|timed?\s*out)/i,
    /network\s*error/i,
    /ECONNREFUSED/i,
  ],
};

/**
 * Detect rate limit for any provider
 */
export function detectRateLimitMulti(
  output: string,
  provider: LLMProviderType
): MultiLLMRateLimitResult {
  // For Claude, use the existing sophisticated detector
  if (provider === 'claude') {
    const claudeResult = detectClaudeRateLimit(output);
    return {
      ...claudeResult,
      provider: 'claude',
      shouldFallback: claudeResult.isRateLimited,
      suggestedWaitMs: claudeResult.isRateLimited ? estimateWaitTime(claudeResult.resetTime) : undefined,
    };
  }

  // For other providers, use pattern matching
  const patterns = RATE_LIMIT_PATTERNS[provider] || [];
  
  for (const pattern of patterns) {
    if (pattern.test(output)) {
      return {
        isRateLimited: true,
        provider,
        shouldFallback: true,
        suggestedWaitMs: 60000, // Default: 1 minute
        originalError: output,
      };
    }
  }

  return {
    isRateLimited: false,
    provider,
    shouldFallback: false,
  };
}

/**
 * Detect auth failure for any provider
 */
export function detectAuthFailureMulti(
  output: string,
  provider: LLMProviderType
): AuthFailureDetectionResult & { provider: LLMProviderType } {
  // For Claude, use the existing detector
  if (provider === 'claude') {
    const claudeResult = detectClaudeAuthFailure(output);
    return {
      ...claudeResult,
      provider: 'claude',
    };
  }

  // For other providers, use pattern matching
  const patterns = AUTH_FAILURE_PATTERNS[provider] || [];
  
  for (const pattern of patterns) {
    if (pattern.test(output)) {
      return {
        isAuthFailure: true,
        provider,
        failureType: 'invalid',
        message: `${provider} authentication failed`,
        originalError: output,
      };
    }
  }

  return {
    isAuthFailure: false,
    provider,
  };
}

/**
 * Detect connection errors
 */
export function detectConnectionError(
  output: string,
  provider: LLMProviderType
): { isConnectionError: boolean; message?: string } {
  const patterns = CONNECTION_ERROR_PATTERNS[provider] || [];
  
  for (const pattern of patterns) {
    if (pattern.test(output)) {
      return {
        isConnectionError: true,
        message: `Failed to connect to ${provider}`,
      };
    }
  }

  return { isConnectionError: false };
}

/**
 * Classify error type
 */
export type ErrorType = 'rate-limit' | 'auth-failure' | 'connection' | 'unknown';

export interface ErrorClassification {
  type: ErrorType;
  provider: LLMProviderType;
  shouldFallback: boolean;
  shouldRetry: boolean;
  message: string;
  suggestedWaitMs?: number;
}

/**
 * Classify an error and determine how to handle it
 */
export function classifyError(
  error: Error | string,
  provider: LLMProviderType
): ErrorClassification {
  const errorStr = error instanceof Error ? error.message : error;

  // Check for rate limit
  const rateLimitResult = detectRateLimitMulti(errorStr, provider);
  if (rateLimitResult.isRateLimited) {
    return {
      type: 'rate-limit',
      provider,
      shouldFallback: true,
      shouldRetry: false,
      message: `${provider} rate limited`,
      suggestedWaitMs: rateLimitResult.suggestedWaitMs,
    };
  }

  // Check for auth failure
  const authResult = detectAuthFailureMulti(errorStr, provider);
  if (authResult.isAuthFailure) {
    return {
      type: 'auth-failure',
      provider,
      shouldFallback: true,
      shouldRetry: false,
      message: authResult.message || `${provider} authentication failed`,
    };
  }

  // Check for connection error
  const connResult = detectConnectionError(errorStr, provider);
  if (connResult.isConnectionError) {
    return {
      type: 'connection',
      provider,
      shouldFallback: true,
      shouldRetry: true, // Connection errors are often transient
      message: connResult.message || `${provider} connection failed`,
      suggestedWaitMs: 5000, // Wait 5s before retry
    };
  }

  // Unknown error
  return {
    type: 'unknown',
    provider,
    shouldFallback: true,
    shouldRetry: true,
    message: `${provider} error: ${errorStr.substring(0, 100)}`,
    suggestedWaitMs: 1000,
  };
}

/**
 * Estimate wait time from reset time string
 */
function estimateWaitTime(resetTimeStr?: string): number | undefined {
  if (!resetTimeStr) {
    return undefined;
  }

  try {
    // Try to parse common formats like "Dec 17 at 6am (Europe/Oslo)"
    // This is a simplified parser - the main detector has more sophisticated parsing
    const now = new Date();
    
    // If it mentions a specific date, it's likely a weekly reset (hours/days)
    if (/[A-Za-z]{3}\s+\d+/.test(resetTimeStr)) {
      // Assume worst case of ~6 hours for weekly resets
      return 6 * 60 * 60 * 1000;
    }
    
    // If it just mentions a time, it's a session reset (minutes to hours)
    // Default to 30 minutes
    return 30 * 60 * 1000;
  } catch {
    return undefined;
  }
}

/**
 * Re-export types from original detector for convenience
 */
export type { RateLimitDetectionResult, AuthFailureDetectionResult };
