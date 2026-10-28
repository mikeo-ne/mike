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

// ------------------------------------------------------- rate-limit safety --
// Groq's free tier budgets tokens per model (each model gets its own token
// bucket). When one model is exhausted we steer the next request to another
// model instead of hammering the same one.
const PRIMARY_OPENAI = 'openai/gpt-oss-120b';
const FALLBACK_OPENAI = 'openai/gpt-oss-20b';

/**
 * Model used by autonomous briefings. Separate from chat so a long briefing
 * never eats the chat budget (and vice versa). Override with CLOCKWORK_MODEL.
 */
export function clockworkModel(): string {
  return process.env.CLOCKWORK_MODEL?.trim() || FALLBACK_OPENAI;
}

/** Ordered backup models for `primary` (primary itself excluded). */
export function fallbackModels(provider: ProviderName, primary: string): string[] {
  if (provider !== 'openai') return [];
  return [PRIMARY_OPENAI, FALLBACK_OPENAI].filter((m) => m !== primary);
}

const cooldownUntil = new Map<string, number>();

/** Pick the first model (primary first) that is not cooling down from a 429. */
export function pickModel(primary: string, fallbacks: string[]): string {
  const now = Date.now();
  for (const m of [primary, ...fallbacks]) {
    if ((cooldownUntil.get(m) ?? 0) <= now) return m;
  }
  return primary;
}

/** Mark a model as rate-limited for `cooldownMs` (default 30s). */
export function reportRateLimit(model: string, cooldownMs = 30_000): void {
  cooldownUntil.set(model, Date.now() + Math.max(0, cooldownMs));
}

export function isRateLimitError(err: unknown): boolean {
  const anyErr = err as { statusCode?: unknown; status?: unknown } | null;
  if (anyErr && (anyErr.statusCode === 429 || anyErr.status === 429)) return true;
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /rate.?limit|429|too many requests|quota exceeded|resource exhausted/i.test(
    msg,
  );
}

/** Honor Groq's own "try again in Ns" hint when present (clamped 2–20s). */
export function parseRetryAfterMs(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const m = /try again in ([\d.]+)\s*s/i.exec(msg);
  if (m) {
    const ms = Math.round(parseFloat(m[1]) * 1000);
    if (Number.isFinite(ms)) return Math.min(20_000, Math.max(2_000, ms));
  }
  return 8_000;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
