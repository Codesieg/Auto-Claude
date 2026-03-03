# Multi-LLM Fallback System

This module provides automatic failover between multiple LLM providers when Claude is rate limited or unavailable.

## Overview

When Claude hits rate limits, the system automatically switches to alternative LLM providers:

1. **Claude** (Primary) - Uses existing Claude Code CLI integration
2. **Ollama** (First Fallback) - Local LLM runner, no API costs
3. **OpenAI** (Optional) - GPT-4/3.5, requires API key
4. **Gemini** (Optional) - Google's Gemini, requires API key

## Architecture

```
apps/frontend/src/main/llm/
├── providers/
│   ├── base-provider.ts      # Abstract LLMProvider interface
│   ├── claude-provider.ts    # Adapter for Claude Code CLI
│   ├── ollama-provider.ts    # Ollama HTTP API client
│   ├── openai-provider.ts    # OpenAI API client (stub)
│   └── gemini-provider.ts    # Google Gemini client (stub)
├── fallback-manager.ts       # Orchestrates fallback chain + retry logic
├── rate-limit-detector.ts    # Detects rate limits across providers
├── config.ts                 # Types and default configuration
├── index.ts                  # Public exports
└── __tests__/               # Unit tests
```

## Usage

### Basic Usage

```typescript
import { getFallbackManager, LLMMessage } from './llm';

// Get the singleton manager
const manager = getFallbackManager();
await manager.initialize();

// Generate with automatic fallback
const messages: LLMMessage[] = [
  { role: 'user', content: 'Hello, can you help me?' }
];

const result = await manager.generate(messages, {
  systemPrompt: 'You are a helpful assistant.',
  temperature: 0.7,
});

console.log(`Response from ${result.provider}:`, result.content);

if (result.wasFallback) {
  console.log(`Fell back from ${result.originalProvider}`);
}
```

### Custom Configuration

```typescript
import { initializeFallbackManager, LLMFallbackConfig } from './llm';

const config: Partial<LLMFallbackConfig> = {
  providers: [
    {
      type: 'claude',
      enabled: true,
      priority: 1,
      config: { useProfileSystem: true },
    },
    {
      type: 'ollama',
      enabled: true,
      priority: 2,
      config: {
        baseUrl: 'http://localhost:11434',
        model: 'codellama:7b',
        timeoutMs: 120000,
      },
    },
    {
      type: 'openai',
      enabled: true,
      priority: 3,
      config: {
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4-turbo-preview',
      },
    },
  ],
  maxRetries: 3,
  retryDelayMs: 1000,
  backoffMultiplier: 2,
  autoSwitchOnRateLimit: true,
};

const manager = initializeFallbackManager(config);
```

### Listening to Events

```typescript
manager.on('llm-event', (event) => {
  console.log(`[${event.type}] ${event.provider}:`, event.details);
});

manager.on('rate-limit-detected', (event) => {
  console.warn('Rate limited:', event.provider);
});

manager.on('provider-switched', (event) => {
  console.log(`Switched from ${event.details?.from} to ${event.details?.to}`);
});
```

### Direct Provider Access

```typescript
import { OllamaProvider, DEFAULT_OLLAMA_CONFIG } from './llm';

const ollama = new OllamaProvider({
  type: 'ollama',
  enabled: true,
  priority: 1,
  config: {
    ...DEFAULT_OLLAMA_CONFIG,
    model: 'qwen2.5-coder:7b',
  },
});

// Check availability
const available = await ollama.isAvailable();

// List models
const models = await ollama.listModels();

// Generate
const result = await ollama.generate([
  { role: 'user', content: 'Explain async/await in JavaScript' }
]);
```

## Ollama Setup

Ollama is the primary fallback provider since it's free and runs locally.

### Installation

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Start the service
ollama serve
```

### Recommended Models

For coding tasks:
```bash
# Qwen 2.5 Coder (7B) - Excellent for code
ollama pull qwen2.5-coder:7b

# CodeLlama (7B/13B) - Meta's code model
ollama pull codellama:7b

# DeepSeek Coder (6.7B) - Strong code model
ollama pull deepseek-coder:6.7b
```

For general tasks:
```bash
# Llama 2 (7B/13B)
ollama pull llama2

# Mistral (7B)
ollama pull mistral
```

### Verify Installation

```bash
# Check Ollama is running
curl http://localhost:11434/api/tags

# Test generation
curl http://localhost:11434/api/generate -d '{
  "model": "qwen2.5-coder:7b",
  "prompt": "Say hello",
  "stream": false
}'
```

## Configuration Options

### LLMFallbackConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `providers` | `LLMProviderConfig[]` | See defaults | List of providers in priority order |
| `maxRetries` | `number` | 3 | Max retry attempts per provider |
| `retryDelayMs` | `number` | 1000 | Initial retry delay |
| `backoffMultiplier` | `number` | 2 | Exponential backoff multiplier |
| `autoSwitchOnRateLimit` | `boolean` | true | Auto-switch when rate limited |
| `rateLimitCooldownMs` | `number` | 300000 | Cooldown after rate limit (5 min) |
| `debug` | `boolean` | false | Enable debug logging |

### OllamaConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | `string` | `http://localhost:11434` | Ollama API URL |
| `model` | `string` | `qwen2.5-coder:7b` | Model to use |
| `timeoutMs` | `number` | 120000 | Request timeout (2 min) |
| `keepAlive` | `string` | `5m` | Keep model loaded |

## Error Handling

The system classifies errors and handles them appropriately:

- **Rate Limit**: Switch to next provider
- **Auth Failure**: Skip provider, mark unavailable
- **Connection Error**: Retry with backoff, then switch
- **Unknown Error**: Retry once, then switch

```typescript
import { classifyError } from './llm';

const classification = classifyError(error, 'ollama');
// { type: 'connection', shouldFallback: true, shouldRetry: true, ... }
```

## Integration with Auto-Claude

The fallback system integrates with existing Auto-Claude features:

1. **Claude Profile System**: Uses existing profile management for Claude
2. **Rate Limit Detection**: Extends existing detector patterns
3. **SDK Features**: Can provide fallback for insights, roadmap, etc.

### Example: SDK Feature with Fallback

```typescript
// In a feature like insights-service.ts
import { getFallbackManager } from '../llm';

async function generateInsight(prompt: string): Promise<string> {
  const manager = getFallbackManager();
  
  const result = await manager.generate([
    { role: 'user', content: prompt }
  ], {
    systemPrompt: 'You are analyzing code. Be concise.',
    temperature: 0.3,
  });
  
  if (result.wasFallback) {
    console.warn(`Using fallback: ${result.provider}`);
  }
  
  return result.content;
}
```

## Testing

Run tests:

```bash
# From frontend directory
npm run test -- --filter=llm

# Specific test
npm run test -- ollama-provider.test.ts
```

Integration tests require Ollama running locally:

```bash
# Start Ollama
ollama serve

# Run integration tests
npm run test -- --filter=ollama --reporter=verbose
```

## Future Enhancements

- [ ] Streaming support for all providers
- [ ] Cost tracking per provider
- [ ] Provider health monitoring dashboard
- [ ] Custom provider plugins
- [ ] Response caching
- [ ] Prompt optimization per provider
