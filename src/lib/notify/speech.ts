/**
 * $0 text-to-speech via Microsoft Edge's online neural voices (no API key).
 * Unofficial endpoint used by many open-source projects; failures throw with
 * a clear message so the Clockwork run history shows what happened.
 */
import { EdgeTTS } from 'node-edge-tts';

const VOICE = 'en-GB-SoniaNeural';

function cleanForSpeech(text: string): string {
  return text
    .replace(/[*_#>`~[\](){}|]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Synthesizes mono MP3 audio for a spoken briefing script. */
export async function synthesizeSpeech(script: string): Promise<Buffer> {
  const text = cleanForSpeech(script).slice(0, 1500);
  if (!text) throw new Error('Nothing to speak for the voice briefing.');
  const tts = new EdgeTTS({
    voice: VOICE,
    lang: 'en-GB',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    timeout: 60_000,
  });
  const chunks: Buffer[] = [];
  for await (const chunk of tts.streamAudio(text)) {
    if (Buffer.isBuffer(chunk)) chunks.push(chunk);
  }
  if (chunks.length === 0) {
    throw new Error('Speech synthesis returned no audio.');
  }
  return Buffer.concat(chunks);
}
