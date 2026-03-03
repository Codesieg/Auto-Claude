/**
 * Claude LLM Provider
 * 
 * Adapter that wraps the existing Claude Code CLI integration.
 * This is the primary provider and uses the existing profile/rate-limit system.
 * 
 * Note: This provider delegates to the existing Claude integration rather than
 * making direct API calls. For direct API access, use the SDK-based features.
 */

import { BaseLLMProvider } from './base-provider';
import type {
  LLMProviderType,
  LLMMessage,
  LLMGenerateOptions,
  LLMGenerateResult,
  LLMProviderConfig,
  ClaudeConfig,
} from '../config';

// Import existing Claude integration utilities
// These handle profile management, rate limits, and CLI invocation
import { getClaudeProfileManager } from '../../claude-profile-manager';
import {
  detectRateLimit,
  detectAuthFailure,
  getBestAvailableProfileEnv,
} from '../../rate-limit-detector';

/**
 * Claude LLM Provider
 * 
 * This provider is special - it wraps the existing Claude Code CLI integration
 * rather than making direct API calls. The actual generation happens through
 * the terminal/PTY system, but this provider handles:
 * 
 * - Availability checking (profile auth, rate limits)
 * - Rate limit detection and reporting
 * - Profile switching suggestions
 * 
 * For SDK-based generation (insights, roadmap, etc.), those features have
 * their own rate limit handling. This provider is primarily for the fallback
 * system to check Claude's availability status.
 */
export class ClaudeProvider extends BaseLLMProvider {
  private claudeConfig: ClaudeConfig;

  constructor(config: LLMProviderConfig) {
    super(config);
    this.claudeConfig = config.config as ClaudeConfig;
  }

  getName(): LLMProviderType {
    return 'claude';
  }

  getDisplayName(): string {
    const profileManager = getClaudeProfileManager();
    const activeProfile = profileManager.getActiveProfile();
    return `Claude (${activeProfile?.name || 'default'})`;
  }

  getModel(): string {
    return this.claudeConfig.model || 'sonnet';
  }

  /**
   * Check if Claude is available (authenticated and not rate limited)
   */
  async isAvailable(): Promise<boolean> {
    try {
      const profileManager = getClaudeProfileManager();
      const activeProfile = profileManager.getActiveProfile();

      // Check if we have any authenticated profiles
      if (!activeProfile) {
        this.logWarn('No active Claude profile');
        this.setStatus('unavailable');
        return false;
      }

      // Check authentication
      if (!activeProfile.isAuthenticated) {
        this.logWarn('Active profile not authenticated');
        this.setStatus('unavailable');
        return false;
      }

      // Check rate limit status using existing system
      const rateLimitStatus = profileManager.isProfileRateLimited(activeProfile.id);
      if (rateLimitStatus.limited) {
        this.logWarn('Active profile rate limited', {
          type: rateLimitStatus.type,
          resetAt: rateLimitStatus.resetAt,
        });
        
        // Try to find an alternative profile
        const bestProfile = profileManager.getBestAvailableProfile(activeProfile.id);
        if (bestProfile) {
          this.log(`Alternative profile available: ${bestProfile.name}`);
          // We still consider Claude "available" if there's an alternative
          this.setStatus('available');
          return true;
        }

        this.setStatus('rate-limited');
        this.markRateLimited(
          rateLimitStatus.resetAt ? new Date(rateLimitStatus.resetAt) : undefined
        );
        return false;
      }

      // Check capacity
      const isAtCapacity = activeProfile.usage?.weeklyUsagePercent !== undefined &&
                           activeProfile.usage.weeklyUsagePercent >= 100;
      if (isAtCapacity) {
        this.logWarn('Active profile at capacity', {
          weeklyUsage: activeProfile.usage?.weeklyUsagePercent,
        });

        // Try to find an alternative profile
        const bestProfile = profileManager.getBestAvailableProfile(activeProfile.id);
        if (bestProfile) {
          this.log(`Alternative profile available: ${bestProfile.name}`);
          this.setStatus('available');
          return true;
        }

        this.setStatus('rate-limited');
        return false;
      }

      this.setStatus('available');
      return true;
    } catch (error) {
      this.logError('Error checking Claude availability', error);
      this.setStatus('error');
      return false;
    }
  }

  /**
   * Generate using Claude
   * 
   * Note: This is a simplified implementation. The actual Claude generation
   * in Auto-Claude happens through the terminal PTY system or the SDK features
   * (insights, roadmap, etc.). This method is here for API consistency.
   * 
   * For real usage, consider:
   * 1. Using the existing SDK-based features which have proper rate limit handling
   * 2. Using the terminal system for interactive Claude sessions
   */
  async generate(
    messages: LLMMessage[],
    options?: LLMGenerateOptions
  ): Promise<LLMGenerateResult> {
    const startTime = Date.now();

    try {
      // Check availability first
      const available = await this.isAvailable();
      if (!available) {
        throw new Error('Claude is not available (rate limited or not authenticated)');
      }

      // Get the best available profile environment
      const { env, profileName, wasSwapped } = getBestAvailableProfileEnv();

      if (wasSwapped) {
        this.log(`Using alternative profile: ${profileName}`);
      }

      // Build the prompt
      const prompt = this.buildClaudePrompt(messages, options);

      this.log('Generation requested', {
        messageCount: messages.length,
        promptLength: prompt.length,
        profile: profileName,
        hasEnv: !!env.CLAUDE_CONFIG_DIR,
      });

      // NOTE: Direct API generation would go here if we add Claude SDK dependency
      // For now, this throws as a reminder that Claude generation goes through
      // the existing terminal or SDK-based systems
      throw new Error(
        'Direct Claude generation not implemented. ' +
        'Use terminal system for interactive sessions or SDK features for background tasks.'
      );

    } catch (error) {
      const durationMs = Date.now() - startTime;
      
      // Check if this is a rate limit error
      if (error instanceof Error) {
        const rateLimitResult = detectRateLimit(error.message);
        if (rateLimitResult.isRateLimited) {
          this.markRateLimited();
          this.logWarn('Rate limit detected in error', {
            resetTime: rateLimitResult.resetTime,
            limitType: rateLimitResult.limitType,
          });
        }

        const authResult = detectAuthFailure(error.message);
        if (authResult.isAuthFailure) {
          this.logWarn('Auth failure detected', {
            type: authResult.failureType,
          });
          this.setStatus('unavailable');
        }
      }

      this.recordError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Check if output indicates a rate limit
   */
  checkForRateLimit(output: string): boolean {
    const result = detectRateLimit(output);
    if (result.isRateLimited) {
      this.markRateLimited();
      return true;
    }
    return false;
  }

  /**
   * Check if output indicates an auth failure
   */
  checkForAuthFailure(output: string): boolean {
    const result = detectAuthFailure(output);
    if (result.isAuthFailure) {
      this.setStatus('unavailable');
      return true;
    }
    return false;
  }

  /**
   * Get the best available profile for Claude operations
   */
  getBestProfile(): { profileId: string; profileName: string; env: Record<string, string> } | null {
    try {
      const { env, profileId, profileName } = getBestAvailableProfileEnv();
      return { profileId, profileName, env };
    } catch {
      return null;
    }
  }

  /**
   * Build a prompt suitable for Claude
   */
  private buildClaudePrompt(
    messages: LLMMessage[],
    options?: LLMGenerateOptions
  ): string {
    const parts: string[] = [];

    // System prompt first
    if (options?.systemPrompt) {
      parts.push(options.systemPrompt);
    }

    // Then messages
    for (const msg of messages) {
      if (msg.role === 'system') {
        parts.push(msg.content);
      } else if (msg.role === 'user') {
        parts.push(`Human: ${msg.content}`);
      } else if (msg.role === 'assistant') {
        parts.push(`Assistant: ${msg.content}`);
      }
    }

    // Claude format ends with Assistant:
    parts.push('Assistant:');

    return parts.join('\n\n');
  }
}
