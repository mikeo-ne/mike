'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Minimal structural types for the Web Speech API (absent from TS DOM lib).
interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResultLike {
  isFinal: boolean;
  0: RecognitionAlternative;
  length: number;
}
interface RecognitionEventLike {
  results: ArrayLike<RecognitionResultLike> & { length: number };
}
interface RecognitionErrorLike {
  error: string;
}
interface RecognitionInstance {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onerror: ((e: RecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => RecognitionInstance;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function synthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Strips Markdown/formatting so spoken replies sound natural. */
export function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' code omitted ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/\|/g, ', ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const AUTO_SPEAK_KEY = '1ne_voice_reply';

const BRAVE_BLOCKED_REASON =
  'Brave blocks voice typing — open 1ne in Chrome or Edge to dictate.';

interface UseVoiceOptions {
  /** Live transcript while dictating (shown in the input). */
  onInterim?: (text: string) => void;
  /** Final dictated text (auto-sent by the caller). */
  onDictated?: (text: string) => void;
}

export function useVoice(opts: UseVoiceOptions = {}) {
  const [autoSpeak, setAutoSpeakState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(AUTO_SPEAK_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [braveBlocked, setBraveBlocked] = useState(false);
  const recRef = useRef<RecognitionInstance | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Brave exposes SpeechRecognition but blocks the speech servers behind it,
  // so every attempt fails with a `network` error. Detect it and say so
  // plainly instead of failing mysteriously.
  useEffect(() => {
    try {
      const nav = window.navigator as Navigator & {
        brave?: { isBrave?: () => unknown };
      };
      const result = nav.brave?.isBrave?.();
      if (result === true) {
        setBraveBlocked(true);
      } else if (result instanceof Promise) {
        result
          .then((v) => {
            if (v === true) setBraveBlocked(true);
          })
          .catch(() => {});
      }
    } catch {
      /* not Brave — ignore */
    }
  }, []);

  const blockedReason = braveBlocked ? BRAVE_BLOCKED_REASON : null;

  const supported = {
    recognition: recognitionCtor() !== null && !braveBlocked,
    synthesis: synthesisSupported(),
  };

  const stopSpeaking = useCallback(() => {
    if (!synthesisSupported()) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!synthesisSupported()) {
        setVoiceError('Voice replies are not supported in this browser.');
        return;
      }
      const clean = stripMarkdownForSpeech(text).slice(0, 2000);
      if (!clean) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = 'en-GB';
      utterance.rate = 1;
      // Prefer a British English voice when available.
      try {
        const voices = window.speechSynthesis.getVoices();
        const pick =
          voices.find((v) => v.lang?.toLowerCase().startsWith('en-gb')) ??
          voices.find((v) => v.lang?.toLowerCase().startsWith('en'));
        if (pick) {
          utterance.voice = pick;
          utterance.lang = pick.lang;
        }
      } catch {
        /* default voice is fine */
      }
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      setSpeaking(true);
      setVoiceError(null);
      window.speechSynthesis.speak(utterance);
    },
    [],
  );

  const setAutoSpeak = useCallback(
    (value: boolean) => {
      setAutoSpeakState(value);
      try {
        window.localStorage.setItem(AUTO_SPEAK_KEY, value ? '1' : '0');
      } catch {
        /* private mode — setting just won't persist */
      }
      if (!value) stopSpeaking();
    },
    [stopSpeaking],
  );

  const stopListening = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* already stopped */
    }
    recRef.current = null;
  }, []);

  const startListening = useCallback(() => {
    if (blockedReason) {
      setVoiceError(blockedReason);
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setVoiceError(
        'Voice input is not supported in this browser — try Chrome or Edge.',
      );
      return;
    }
    stopSpeaking();
    setVoiceError(null);
    const rec = new Ctor();
    rec.lang = 'en-GB';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    recRef.current = rec;
    rec.onresult = (e) => {
      let interim = '';
      let finalText = '';
      for (let i = 0; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0]?.transcript ?? '';
        else interim += r[0]?.transcript ?? '';
      }
      if (interim.trim()) optsRef.current.onInterim?.(interim.trim());
      if (finalText.trim()) {
        optsRef.current.onDictated?.(finalText.trim());
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setVoiceError(
          'Microphone blocked — allow mic access in the browser address bar, then try again.',
        );
      } else if (e.error === 'network' && blockedReason) {
        setVoiceError(blockedReason);
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        setVoiceError(`Voice input stopped (${e.error}). Tap the mic to retry.`);
      }
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
    };
    try {
      rec.start();
      setListening(true);
    } catch {
      setVoiceError('Could not start voice input. Tap the mic to retry.');
    }
  }, [stopSpeaking, blockedReason]);

  // Stop everything on unmount so audio never leaks across navigation.
  useEffect(
    () => () => {
      try {
        recRef.current?.abort();
      } catch {
        /* noop */
      }
      if (synthesisSupported()) window.speechSynthesis.cancel();
    },
    [],
  );

  return {
    supported,
    blockedReason,
    autoSpeak,
    setAutoSpeak,
    speak,
    stopSpeaking,
    speaking,
    listening,
    startListening,
    stopListening,
    voiceError,
    clearVoiceError: () => setVoiceError(null),
  };
}
