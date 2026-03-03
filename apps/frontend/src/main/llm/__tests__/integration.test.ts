/**
 * LLM Integration Tests
 * 
 * These tests can run outside of Electron context.
 * For full FallbackManager tests, run in Electron environment.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OllamaProvider } from '../providers/ollama-provider';
import {
  detectRateLimitMulti,
  detectAuthFailureMulti,
  detectConnectionError,
  classifyError,
} from '../rate-limit-detector';
import type { LLMProviderConfig } from '../config';

// Ollama test config
const OLLAMA_CONFIG: LLMProviderConfig = {
  type: 'ollama',
  enabled: true,
  priority: 1,
  config: {
    baseUrl: 'http://localhost:11434',
    model: 'qwen2.5-coder:7b',
    timeoutMs: 60000,
    keepAlive: '5m',
  },
};

describe('Rate Limit Detection', () => {
  describe('Claude patterns', () => {
    it('should detect Claude rate limit', () => {
      const output = 'Limit reached · resets Dec 17 at 6am (Europe/Oslo)';
      const result = detectRateLimitMulti(output, 'claude');
      
      expect(result.isRateLimited).toBe(true);
      expect(result.provider).toBe('claude');
      expect(result.shouldFallback).toBe(true);
    });

    it('should detect generic rate limit', () => {
      const output = 'Error: rate limit exceeded';
      const result = detectRateLimitMulti(output, 'claude');
      
      expect(result.isRateLimited).toBe(true);
    });

    it('should not false positive on normal output', () => {
      const output = 'Here is your code:\nfunction limit() {}';
      const result = detectRateLimitMulti(output, 'claude');
      
      expect(result.isRateLimited).toBe(false);
    });
  });

  describe('OpenAI patterns', () => {
    it('should detect OpenAI rate limit', () => {
      const result = detectRateLimitMulti('rate_limit_exceeded', 'openai');
      expect(result.isRateLimited).toBe(true);
    });

    it('should detect quota exceeded', () => {
      const result = detectRateLimitMulti('insufficient_quota', 'openai');
      expect(result.isRateLimited).toBe(true);
    });
  });

  describe('Ollama patterns', () => {
    it('should detect busy server', () => {
      const result = detectRateLimitMulti('server is busy', 'ollama');
      expect(result.isRateLimited).toBe(true);
    });
  });
});

describe('Auth Failure Detection', () => {
  it('should detect Claude auth failure', () => {
    const result = detectAuthFailureMulti('authentication required', 'claude');
    expect(result.isAuthFailure).toBe(true);
  });

  it('should detect OpenAI invalid key', () => {
    const result = detectAuthFailureMulti('invalid_api_key', 'openai');
    expect(result.isAuthFailure).toBe(true);
  });

  it('should detect Gemini permission denied', () => {
    const result = detectAuthFailureMulti('permission_denied', 'gemini');
    expect(result.isAuthFailure).toBe(true);
  });
});

describe('Connection Error Detection', () => {
  it('should detect connection refused', () => {
    const result = detectConnectionError('connect ECONNREFUSED 127.0.0.1:11434', 'ollama');
    expect(result.isConnectionError).toBe(true);
  });

  it('should detect timeout', () => {
    const result = detectConnectionError('ETIMEDOUT', 'claude');
    expect(result.isConnectionError).toBe(true);
  });
});

describe('Error Classification', () => {
  it('should classify rate limit errors', () => {
    const classification = classifyError('rate limit exceeded', 'claude');
    
    expect(classification.type).toBe('rate-limit');
    expect(classification.shouldFallback).toBe(true);
    expect(classification.shouldRetry).toBe(false);
  });

  it('should classify auth errors', () => {
    const classification = classifyError('invalid_api_key', 'openai');
    
    expect(classification.type).toBe('auth-failure');
    expect(classification.shouldFallback).toBe(true);
    expect(classification.shouldRetry).toBe(false);
  });

  it('should classify connection errors', () => {
    const classification = classifyError('ECONNREFUSED', 'ollama');
    
    expect(classification.type).toBe('connection');
    expect(classification.shouldFallback).toBe(true);
    expect(classification.shouldRetry).toBe(true);
  });

  it('should classify unknown errors', () => {
    const classification = classifyError('Something weird happened', 'ollama');
    
    expect(classification.type).toBe('unknown');
    expect(classification.shouldFallback).toBe(true);
    expect(classification.shouldRetry).toBe(true);
  });
});

describe('OllamaProvider Integration', () => {
  let provider: OllamaProvider;

  beforeAll(() => {
    provider = new OllamaProvider(OLLAMA_CONFIG);
  });

  afterAll(async () => {
    await provider.dispose();
  });

  it('should have correct name', () => {
    expect(provider.getName()).toBe('ollama');
  });

  it('should have correct model', () => {
    expect(provider.getModel()).toBe('qwen2.5-coder:7b');
  });

  it('should check availability without throwing', async () => {
    const available = await provider.isAvailable();
    expect(typeof available).toBe('boolean');
  });

  it('should generate text if available', async () => {
    const available = await provider.isAvailable();
    if (!available) {
      console.log('Skipping: Ollama not available');
      return;
    }

    const result = await provider.generate(
      [{ role: 'user', content: 'Say "test" and nothing else' }],
      { temperature: 0, maxTokens: 10 }
    );

    expect(result.content).toBeTruthy();
    expect(result.provider).toBe('ollama');
    expect(result.durationMs).toBeGreaterThan(0);
  }, 30000);

  it('should handle rate limit marking', () => {
    expect(provider.isRateLimited()).toBe(false);
    
    provider.markRateLimited();
    expect(provider.isRateLimited()).toBe(true);
    
    provider.clearRateLimit();
    expect(provider.isRateLimited()).toBe(false);
  });
});
