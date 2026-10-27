/**
 * Telegram delivery (server-only, dependency-free Bot API calls).
 *
 * Clockwork uses this to send the morning briefing as Telegram text plus a
 * playable voice note. The Bot API is free with no trial, region block, or
 * per-message cost — ideal for a daily briefing.
 *
 * Env: TELEGRAM_BOT_TOKEN (from @BotFather), TELEGRAM_CHAT_ID (default
 * recipient — message @userinfobot to learn yours).
 */

export interface TelegramConfig {
  botToken: string;
}

export function telegramConfig(): TelegramConfig {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    throw new Error(
      'Telegram delivery is not configured. Set TELEGRAM_BOT_TOKEN in secrets (create a bot via @BotFather).',
    );
  }
  return { botToken };
}

/** Default recipient chat id. */
export function defaultTelegramChat(): string | null {
  return process.env.TELEGRAM_CHAT_ID?.trim() || null;
}

interface TelegramApiResult {
  message_id?: number;
}

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
  result?: TelegramApiResult;
}

async function callMethod(
  botToken: string,
  method: string,
  body: FormData | string,
  isJson: boolean,
  timeoutMs: number,
): Promise<number> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: isJson ? { 'Content-Type': 'application/json' } : undefined,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json().catch(() => ({}))) as TelegramApiResponse;
  if (!res.ok || !data.ok) {
    throw new Error(data.description || `Telegram ${method} failed.`);
  }
  return data.result?.message_id ?? 0;
}

function chunkText(text: string, size = 4000): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size / 2) cut = size;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * Sends text (chunked to Telegram's 4096-char limit). Plain text — no
 * parse_mode — so briefing Markdown can never break entity parsing.
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<{ messageId: number }> {
  const { botToken } = telegramConfig();
  const id = chatId.trim();
  if (!id) throw new Error('No Telegram chat id for delivery.');
  let lastId = 0;
  for (const chunk of chunkText(text)) {
    lastId = await callMethod(
      botToken,
      'sendMessage',
      JSON.stringify({
        chat_id: id,
        text: chunk,
        disable_web_page_preview: true,
      }),
      true,
      30_000,
    );
    // Bot API guideline: ~1 message/second to the same chat.
    await new Promise((r) => setTimeout(r, 1100));
  }
  return { messageId: lastId };
}

/** Sends an MP3 buffer as a playable voice message. */
export async function sendTelegramVoice(
  chatId: string,
  audioMp3: Buffer,
  caption?: string,
): Promise<{ messageId: number }> {
  const { botToken } = telegramConfig();
  const id = chatId.trim();
  if (!id) throw new Error('No Telegram chat id for delivery.');
  if (audioMp3.length === 0) throw new Error('Empty audio for voice note.');
  if (audioMp3.length > 45 * 1024 * 1024) {
    throw new Error('Voice note audio is too large for Telegram.');
  }
  const form = new FormData();
  form.set('chat_id', id);
  form.set(
    'voice',
    new Blob([new Uint8Array(audioMp3)], { type: 'audio/mpeg' }),
    'briefing.mp3',
  );
  if (caption?.trim()) form.set('caption', caption.trim().slice(0, 1024));
  const messageId = await callMethod(botToken, 'sendVoice', form, false, 90_000);
  return { messageId };
}
