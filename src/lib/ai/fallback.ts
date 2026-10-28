import { generateText } from 'ai';
import type { ProviderName } from './types';
import {
  isRateLimitError,
  parseRetryAfterMs,
  pickModel,
  reportRateLimit,
  sleep,
} from './config';
import { resolveChatModel } from './sdk';

export { sleep };

type BaseOpts = Omit<
  Parameters<typeof generateText>[0],
  'model' | 'maxRetries'
>;

/**
 * Runs generateText, retrying rate limits on the next model in the chain
 * instead of hammering the same one (which is what the SDK's built-in
 * same-model retries do). Each model has its own free-tier token bucket, so
 * switching models usually succeeds immediately. Non-429 errors throw
 * right away. Demo/mock mode succeeds on the first attempt, unchanged.
 */
export async function generateTextWithFallback(
  provider: ProviderName,
  primary: string,
  fallbacks: string[],
  apiKey: string | null,
  opts: BaseOpts,
): Promise<Awaited<ReturnType<typeof generateText>>> {
  const first = pickModel(primary, fallbacks);
  const order = [first, primary, ...fallbacks].filter(
    (m, i, a) => a.indexOf(m) === i,
  );
  let lastError: unknown = null;
  for (const model of order) {
    try {
      return await generateText({
        ...opts,
        model: resolveChatModel(provider, model, apiKey),
        // Our cross-model retry loop below replaces the SDK's same-model one.
        maxRetries: 0,
      });
    } catch (err) {
      lastError = err;
      if (!isRateLimitError(err)) throw err;
      reportRateLimit(model);
      await sleep(parseRetryAfterMs(err));
    }
  }
  throw lastError;
}
