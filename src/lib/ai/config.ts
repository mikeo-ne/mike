/**
 * Provider/model resolution from environment (server-only: touches secrets).
 */
import type { ProviderName } from './types';

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

export function defaultProvider(): ProviderName {
  return process.env.AI_PROVIDER?.trim().toLowerCase() === 'anthropic'
    ? 'anthropic'
    : 'openai';
}

export function defaultModel(provider: ProviderName): string {
  const override = process.env.AI_MODEL?.trim();
  if (override) return override;
  return provider === 'anthropic'
    ? DEFAULT_ANTHROPIC_MODEL
    : DEFAULT_OPENAI_MODEL;
}

/** API key for a provider, or null when not configured (→ demo mode). */
export function apiKeyFor(provider: ProviderName): string | null {
  if (provider === 'anthropic') {
    return process.env.ANTHROPIC_API_KEY?.trim() || null;
  }
  return process.env.OPENAI_API_KEY?.trim() || null;
}

export function maxSteps(): number {
  const n = Number.parseInt(process.env.AGENT_MAX_STEPS ?? '6', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 12) : 6;
}

export function normalizeProvider(value: unknown): ProviderName {
  return value === 'anthropic' ? 'anthropic' : 'openai';
}
