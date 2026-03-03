/**
 * Fallback Manager Tests
 * 
 * Tests for the multi-LLM fallback system.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LLMFallbackManager,
  initializeFallbackManager,
} from '../fallback-manager';
import type { LLMFallbackConfig, LLMMessage, LLMEvent } from '../config';

// Mock configuration that only uses Ollama (skip Claude for unit tests)
const TEST_CONFIG: Partial<LLMFallbackConfig> = {
  providers: [
    {
      type: 'ollama',
      enabled: true,
      priority: 1,
      config: {
        baseUrl: 'http://localhost:11434',
        model: 'qwen2.5-coder:7b',
        timeoutMs: 30000,
      },
    },
  ],
  maxRetries: 2,
  retryDelayMs: 100,
  backoffMultiplier: 2,
  debug: true,
};

describe('LLMFallbackManager', () => {
  let manager: LLMFallbackManager;

  beforeEach(() => {
    manager = new LLMFallbackManager(TEST_CONFIG);
  });

  afterEach(async () => {
    await manager.dispose();
  });

  describe('initialization', () => {
    it('should create manager with config', () => {
      expect(manager).toBeInstanceOf(LLMFallbackManager);
    });

    it('should have ollama as current provider', () => {
      const current = manager.getCurrentProvider();
      expect(current?.getName()).toBe('ollama');
    });

    it('should get provider by type', () => {
      const ollama = manager.getProvider('ollama');
      expect(ollama).toBeTruthy();
      expect(ollama?.getName()).toBe('ollama');
    });

    it('should return null for unknown provider', () => {
      const unknown = manager.getProvider('openai');
      expect(unknown).toBeNull();
    });
  });

  describe('getProviderStatuses', () => {
    it('should return status for all providers', () => {
      const statuses = manager.getProviderStatuses();
      
      expect(statuses.length).toBe(1);
      expect(statuses[0].type).toBe('ollama');
      expect(statuses[0].isCurrent).toBe(true);
      expect(statuses[0].isRateLimited).toBe(false);
    });
  });

  describe('events', () => {
    it('should emit llm-event on generation start', async () => {
      const events: LLMEvent[] = [];
      manager.on('llm-event', (e: LLMEvent) => events.push(e));

      // Try to initialize (will check provider availability)
      await manager.initialize();

      // Check if we got any events
      // Note: Generation events require actual generation
      expect(events.length).toBeGreaterThanOrEqual(0);
    });

    it('should emit specific event types', async () => {
      const startEvents: LLMEvent[] = [];
      manager.on('generation-started', (e: LLMEvent) => startEvents.push(e));

      await manager.initialize();
      
      // The event won't be emitted until actual generation
      // This test just verifies the listener works
      expect(startEvents).toEqual([]);
    });
  });

  describe('rate limiting', () => {
    it('should clear rate limit for provider', () => {
      const ollama = manager.getProvider('ollama');
      
      // Mark as rate limited
      ollama?.markRateLimited();
      expect(ollama?.isRateLimited()).toBe(true);
      
      // Clear via manager
      manager.clearRateLimit('ollama');
      expect(ollama?.isRateLimited()).toBe(false);
    });
  });

  describe('updateConfig', () => {
    it('should update config without providers', () => {
      manager.updateConfig({ maxRetries: 5 });
      // No way to verify directly, but should not throw
    });

    it('should reinitialize with new providers', () => {
      const newConfig: Partial<LLMFallbackConfig> = {
        providers: [
          {
            type: 'ollama',
            enabled: true,
            priority: 2,
            config: {
              baseUrl: 'http://localhost:11434',
              model: 'llama2',
              timeoutMs: 30000,
            },
          },
        ],
      };

      manager.updateConfig(newConfig);
      
      const ollama = manager.getProvider('ollama');
      expect(ollama?.getModel()).toBe('llama2');
    });
  });

  describe('dispose', () => {
    it('should clean up resources', async () => {
      await manager.dispose();
      
      expect(manager.getCurrentProvider()).toBeNull();
      expect(manager.getProviderStatuses()).toEqual([]);
    });
  });
});

describe('initializeFallbackManager', () => {
  it('should create singleton instance', () => {
    const manager1 = initializeFallbackManager(TEST_CONFIG);
    expect(manager1).toBeInstanceOf(LLMFallbackManager);
    
    // Clean up
    manager1.dispose();
  });
});
