export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function truncate(text: string, max = 60): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Safe JSON serialization for unknown tool results. */
export function safeJson(value: unknown, maxChars = 8000): string {
  try {
    const s = JSON.stringify(value, null, 2) ?? String(value);
    return s.length > maxChars ? `${s.slice(0, maxChars)}…(truncated)` : s;
  } catch {
    const s = String(value);
    return s.length > maxChars ? `${s.slice(0, maxChars)}…(truncated)` : s;
  }
}
