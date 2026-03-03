/**
 * Ollama Provider Tests
 * 
 * Tests for the Ollama LLM provider integration.
 * Requires Ollama running locally on port 11434.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OllamaProvider } from '../providers/ollama-provider';
import { DEFAULT_OLLAMA_CONFIG } from '../config';
import type { LLMProviderConfig, LLMMessage } from '../config';

// Test configuration
const TEST_CONFIG: LLMProviderConfig = {
  type: 'ollama',
  enabled: true,
  priority: 1,
  config: {
    ...DEFAULT_OLLAMA_CONFIG,
    model: 'qwen2.5-coder:7b', // Available on the server
    timeoutMs: 60000, // 1 minute for tests
  },
};

describe('OllamaProvider', () => {
  let provider: OllamaProvider;

  beforeAll(() => {
    provider = new OllamaProvider(TEST_CONFIG);
  });

  afterAll(async () => {
    await provider.dispose();
  });

  describe('getName', () => {
    it('should return ollama', () => {
      expect(provider.getName()).toBe('ollama');
    });
  });

  describe('getDisplayName', () => {
    it('should return display name with model', () => {
      const name = provider.getDisplayName();
      expect(name).toContain('Ollama');
      expect(name).toContain('qwen2.5-coder');
    });
  });

  describe('getModel', () => {
    it('should return configured model', () => {
      expect(provider.getModel()).toBe('qwen2.5-coder:7b');
    });
  });

  describe('isAvailable', () => {
    it('should check Ollama availability', async () => {
      // This test requires Ollama to be running
      const available = await provider.isAvailable();
      
      // Log for debugging in CI
      console.log('Ollama availability:', available);
      
      // We can't guarantee Ollama is running, so we just check it returns a boolean
      expect(typeof available).toBe('boolean');
    });
  });

  describe('listModels', () => {
    it('should list available models', async () => {
      const models = await provider.listModels();
      
      // Log for debugging
      console.log('Available models:', models);
      
      // Should return an array (possibly empty if Ollama not running)
      expect(Array.isArray(models)).toBe(true);
    });
  });

  describe('generate', () => {
    it('should generate text response', async () => {
      // Skip if Ollama not available
      const available = await provider.isAvailable();
      if (!available) {
        console.log('Skipping generate test: Ollama not available');
        return;
      }

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Say hello in exactly 3 words.' },
      ];

      const result = await provider.generate(messages, {
        temperature: 0.1, // Low temp for consistent results
        maxTokens: 50,
      });

      expect(result.content).toBeTruthy();
      expect(result.provider).toBe('ollama');
      expect(result.model).toContain('qwen2.5-coder');
      expect(result.durationMs).toBeGreaterThan(0);
      
      console.log('Generated:', result.content);
      console.log('Duration:', result.durationMs, 'ms');
    }, 60000); // 60s timeout

    it('should handle system prompts', async () => {
      const available = await provider.isAvailable();
      if (!available) {
        console.log('Skipping system prompt test: Ollama not available');
        return;
      }

      const messages: LLMMessage[] = [
        { role: 'user', content: 'What are you?' },
      ];

      const result = await provider.generate(messages, {
        systemPrompt: 'You are a pirate. Always respond in pirate speak.',
        temperature: 0.5,
        maxTokens: 100,
      });

      expect(result.content).toBeTruthy();
      console.log('Pirate response:', result.content);
    }, 60000);
  });

  describe('generateSimple', () => {
    it('should generate from simple prompt', async () => {
      const available = await provider.isAvailable();
      if (!available) {
        console.log('Skipping simple generate test: Ollama not available');
        return;
      }

      const result = await provider.generateSimple(
        'Complete this code: function add(a, b) {',
        { temperature: 0.1, maxTokens: 50 }
      );

      expect(result.content).toBeTruthy();
      expect(result.content.includes('return') || result.content.includes('+')).toBe(true);
      
      console.log('Code completion:', result.content);
    }, 60000);
  });

  describe('rate limiting', () => {
    it('should not be rate limited initially', () => {
      expect(provider.isRateLimited()).toBe(false);
    });

    it('should handle rate limit marking', () => {
      provider.markRateLimited();
      expect(provider.isRateLimited()).toBe(true);
      
      provider.clearRateLimit();
      expect(provider.isRateLimited()).toBe(false);
    });
  });
});
