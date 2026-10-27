/**
 * Fallback webhook integration (server-only).
 *
 * Every calendar mutation payload can be forwarded to an external URL —
 * e.g. a Cal.com endpoint, a Make.com scenario, or any custom webhook —
 * configured via CALENDAR_WEBHOOK_URL (optional HMAC signing via
 * CALENDAR_WEBHOOK_SECRET). Used by:
 *   - the tool-execution path (fire-and-forget after each mutation), and
 *   - POST /api/calendar/webhook (extensible relay route).
 *
 * With no URL configured the forwarder runs in mock mode: payloads are
 * validated and echoed back without any network call.
 */
import { createHmac } from 'node:crypto';

export type WebhookAction =
  | 'created'
  | 'updated'
  | 'rescheduled'
  | 'deleted'
  | 'cancelled'
  | 'test';

export interface CalendarWebhookPayload {
  action: WebhookAction;
  calendar: 'local' | 'google';
  event: Record<string, unknown>;
  conflicts?: Array<Record<string, unknown>>;
  note?: string;
}

export interface ForwardResult {
  forwarded: boolean;
  mode: 'live' | 'mock';
  status?: number;
  response?: string;
  error?: string;
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Forwards a calendar payload to CALENDAR_WEBHOOK_URL. Never throws —
 * failures are reported in the result so tool execution is never broken
 * by a misbehaving downstream.
 */
export async function forwardCalendarPayload(
  payload: CalendarWebhookPayload,
): Promise<ForwardResult> {
  const url = process.env.CALENDAR_WEBHOOK_URL?.trim();
  const envelope = {
    source: 'mike',
    occurred_at: new Date().toISOString(),
    ...payload,
  };
  if (!url) {
    return { forwarded: false, mode: 'mock' };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { forwarded: false, mode: 'live', error: 'CALENDAR_WEBHOOK_URL is not a valid URL.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      forwarded: false,
      mode: 'live',
      error: 'CALENDAR_WEBHOOK_URL must use http(s).',
    };
  }
  const body = JSON.stringify(envelope);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'mike-webhook/1.0',
  };
  const secret = process.env.CALENDAR_WEBHOOK_SECRET?.trim();
  if (secret) {
    headers['X-Mike-Signature'] = `sha256=${sign(body, secret)}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      return {
        forwarded: false,
        mode: 'live',
        status: res.status,
        error: `Downstream responded with status ${res.status}.`,
        response: text.slice(0, 500),
      };
    }
    return {
      forwarded: true,
      mode: 'live',
      status: res.status,
      response: text.slice(0, 500),
    };
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'Downstream timed out after 6s.'
        : err instanceof Error
          ? err.message
          : String(err);
    return { forwarded: false, mode: 'live', error: message };
  } finally {
    clearTimeout(timer);
  }
}

/** Fire-and-forget notification used after successful tool mutations. */
export function notifyCalendarWebhook(payload: CalendarWebhookPayload): void {
  void forwardCalendarPayload(payload).catch(() => {
    /* forwarding must never break the caller */
  });
}
