import { Platform } from "react-native";
import * as Speech from "expo-speech";
import i18n from "../../i18n";

function webSpeechAvailable(): boolean {
  return (
    Platform.OS === "web" &&
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis !== "undefined" &&
    typeof (globalThis as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance })
      .SpeechSynthesisUtterance !== "undefined"
  );
}

function getSynth(): SpeechSynthesis | null {
  if (!webSpeechAvailable()) return null;
  return (globalThis as { speechSynthesis: SpeechSynthesis }).speechSynthesis;
}

let webAudioUnlocked = false;
let voicesReadyPromise: Promise<SpeechSynthesisVoice[]> | null = null;
let cancelSettleTimer: ReturnType<typeof setTimeout> | null = null;
const unlockListeners = new Set<(unlocked: boolean) => void>();

function notifyUnlock() {
  for (const l of unlockListeners) {
    try {
      l(webAudioUnlocked);
    } catch {
      // ignore
    }
  }
}

export function isWebSpeechUnlocked(): boolean {
  if (!webSpeechAvailable()) return true;
  return webAudioUnlocked;
}

export function onWebSpeechUnlockChange(listener: (unlocked: boolean) => void) {
  unlockListeners.add(listener);
  return () => {
    unlockListeners.delete(listener);
  };
}

/** Wait until browser voices are populated (or timeout). */
function ensureVoicesReady(): Promise<SpeechSynthesisVoice[]> {
  const synth = getSynth();
  if (!synth) return Promise.resolve([]);

  const existing = synth.getVoices();
  if (existing.length > 0) return Promise.resolve(existing);

  if (voicesReadyPromise) return voicesReadyPromise;

  voicesReadyPromise = new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        synth.removeEventListener("voiceschanged", onChange);
      } catch {
        // ignore
      }
      resolve(synth.getVoices());
    };
    const onChange = () => finish();
    synth.addEventListener("voiceschanged", onChange);
    // Some browsers never fire voiceschanged — don't block forever
    setTimeout(finish, 1500);
    // Prime the list
    void synth.getVoices();
  });
  return voicesReadyPromise;
}

function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const exact = voices.find((v) => v.lang === lang);
  if (exact) return exact;
  const prefix = lang.slice(0, 2).toLowerCase();
  return voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) || voices[0] || null;
}

/**
 * Unlock browser TTS under the user-gesture policy.
 * Must run synchronously in a click/tap handler (Start AI session, voice toggle, Test Audio).
 */
export function unlockWebSpeech(): void {
  if (!webSpeechAvailable()) return;
  const synth = getSynth()!;
  void ensureVoicesReady();
  try {
    // Chromium: empty/near-silent unlock often fails — use a tiny audible warm-up
    try {
      synth.cancel();
    } catch {
      // ignore
    }
    const warm = new SpeechSynthesisUtterance("Coach ready");
    warm.volume = 0.35;
    warm.rate = 1.35;
    warm.pitch = 1;
    const lang = speechLocaleForAppLang(i18n.language);
    warm.lang = lang;
    warm.onstart = () => {
      webAudioUnlocked = true;
      notifyUnlock();
      console.log("[WebTTS] unlock onstart");
    };
    warm.onend = () => {
      webAudioUnlocked = true;
      notifyUnlock();
      console.log("[WebTTS] unlock onend");
    };
    warm.onerror = (e) => {
      // Gesture still consumed; mark unlocked so later cues can try
      webAudioUnlocked = true;
      notifyUnlock();
      console.warn("[WebTTS] unlock onerror", e.error);
    };
    if (synth.paused) synth.resume();
    synth.speak(warm);
    if (synth.paused) synth.resume();
    webAudioUnlocked = true;
    notifyUnlock();
    console.log("[WebTTS] unlockWebSpeech() — gesture unlock issued", {
      speaking: synth.speaking,
      pending: synth.pending,
      paused: synth.paused,
      voices: synth.getVoices().length,
    });
  } catch (err) {
    console.warn("[WebTTS] unlockWebSpeech failed", err);
  }
}

function stopWebSpeech(): Promise<void> {
  const synth = getSynth();
  if (!synth) return Promise.resolve();
  try {
    synth.cancel();
  } catch {
    // ignore
  }
  // cancel()+speak() in the same tick drops utterances in Chromium
  return new Promise((resolve) => {
    if (cancelSettleTimer) clearTimeout(cancelSettleTimer);
    cancelSettleTimer = setTimeout(() => {
      cancelSettleTimer = null;
      resolve();
    }, 90);
  });
}

function stopAllSpeech(): void {
  void stopWebSpeech();
  // On web, expo Speech.stop === speechSynthesis.cancel — skip to avoid double-cancel races
  if (!webSpeechAvailable()) {
    try {
      Speech.stop();
    } catch {
      // ignore
    }
  }
}

/** Dev/manual isolation: speak raw text with no coach queue. */
export function speakTestUtterance(text = "Test audio one two three"): void {
  if (!webSpeechAvailable()) {
    Speech.speak(text, { language: speechLocaleForAppLang(i18n.language) });
    return;
  }
  unlockWebSpeech();
  const synth = getSynth()!;
  void (async () => {
    await ensureVoicesReady();
    await stopWebSpeech();
    const voices = synth.getVoices();
    const lang = speechLocaleForAppLang(i18n.language);
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    const voice = pickVoice(voices, lang);
    if (voice) utter.voice = voice;
    utter.volume = 1;
    utter.onstart = () => console.log("[WebTTS] TEST onstart");
    utter.onend = () => console.log("[WebTTS] TEST onend");
    utter.onerror = (e) => console.error("[WebTTS] TEST onerror", e.error);
    console.log("[WebTTS] TEST before speak", {
      text,
      speaking: synth.speaking,
      pending: synth.pending,
      paused: synth.paused,
      voices: voices.length,
      unlocked: webAudioUnlocked,
      voice: voice?.name || null,
    });
    if (synth.paused) synth.resume();
    synth.speak(utter);
    if (synth.paused) synth.resume();
  })();
}

export type CoachPriority = "safety" | "correction" | "encouragement";
export type VoiceMode = "full" | "corrections_only" | "muted";

export type CoachCue = {
  id: string;
  /** i18n key, e.g. cue_go_deeper */
  key: string;
  priority: CoachPriority;
  createdAt: number;
  repIndex?: number;
};

type QueueOptions = {
  muted?: boolean;
  correctionsOnly?: boolean;
  voiceMode?: VoiceMode;
  lang?: string;
};

const SAFETY_GAP_MS = 6000;
const CORRECTION_COOLDOWN_MS = 12000;
const MIN_UTTERANCE_GAP_MS = 1500;
const ENCOURAGE_EVERY_N_REPS = 5;
const SPEAK_WATCHDOG_MS = 2800;

type SpeakingListener = (speaking: boolean, cueKey: string | null, priority: CoachPriority | null) => void;

/** Map app language tags to expo-speech / OS voice locales. */
export function speechLocaleForAppLang(lang?: string | null): string {
  const raw = String(lang || i18n.language || "en").toLowerCase();
  if (raw.startsWith("hinglish") || raw.startsWith("hi")) return "hi-IN";
  if (raw.startsWith("es")) return "es-ES";
  if (raw.startsWith("fr")) return "fr-FR";
  if (raw.startsWith("de")) return "de-DE";
  return "en-US";
}

/**
 * Priority queue for AI trainer TTS.
 * Web → speechSynthesis; native → expo-speech.
 */
export class AudioCoachQueue {
  private queue: CoachCue[] = [];
  private speaking = false;
  /** Web: hold the pump until onstart/onerror (don't block on false-positive speaking). */
  private webSpeakPending = false;
  private lastSpokeAt = 0;
  private lastSafetyById = new Map<string, number>();
  private lastCorrectionById = new Map<string, number>();
  private opts: QueueOptions = {};
  private currentRep = 0;
  private encourageCounter = 0;
  private listeners = new Set<SpeakingListener>();
  private currentKey: string | null = null;
  private currentPriority: CoachPriority | null = null;
  private pumpGeneration = 0;
  private speakWatchdog: ReturnType<typeof setTimeout> | null = null;

  onSpeakingChange(listener: SpeakingListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  isSpeaking() {
    return this.speaking || this.webSpeakPending;
  }

  currentCue() {
    return { key: this.currentKey, priority: this.currentPriority, speaking: this.speaking };
  }

  private emit() {
    for (const l of this.listeners) {
      try {
        l(this.speaking, this.currentKey, this.currentPriority);
      } catch {
        // ignore listener errors
      }
    }
  }

  configure(opts: QueueOptions) {
    const next = { ...this.opts, ...opts };
    if (opts.voiceMode === "muted" || opts.muted) {
      next.muted = true;
      next.correctionsOnly = false;
    } else if (opts.voiceMode === "corrections_only") {
      next.muted = false;
      next.correctionsOnly = true;
    } else if (opts.voiceMode === "full") {
      next.muted = false;
      next.correctionsOnly = false;
    }
    this.opts = next;
    if (this.opts.muted) this.clear();
  }

  setRepIndex(rep: number) {
    this.queue = this.queue.filter(
      (c) => c.priority === "safety" || c.repIndex == null || c.repIndex >= rep - 1,
    );
    this.currentRep = rep;
  }

  enqueue(cue: CoachCue) {
    if (this.opts.muted) return;
    if (this.opts.correctionsOnly && cue.priority === "encouragement") return;

    const now = Date.now();
    if (cue.priority === "safety") {
      const last = this.lastSafetyById.get(cue.id) || 0;
      if (now - last < SAFETY_GAP_MS) return;
      this.speaking = false;
      this.webSpeakPending = false;
      this.queue = [cue, ...this.queue.filter((c) => c.priority === "safety" && c.id !== cue.id)];
      this.lastSafetyById.set(cue.id, now);
      // Cancel then settle before next speak (Chromium drop bug)
      void stopWebSpeech().then(() => {
        if (!webSpeechAvailable()) {
          try {
            Speech.stop();
          } catch {
            // ignore
          }
        }
        this.pump();
      });
      return;
    }

    if (cue.priority === "correction") {
      const last = this.lastCorrectionById.get(cue.id) || 0;
      if (now - last < CORRECTION_COOLDOWN_MS) return;
      this.queue = this.queue.filter(
        (c) => !(c.priority === "correction" && c.repIndex === cue.repIndex),
      );
      this.queue.push(cue);
      this.lastCorrectionById.set(cue.id, now);
      this.pump();
      return;
    }

    this.encourageCounter += 1;
    if (this.encourageCounter % ENCOURAGE_EVERY_N_REPS !== 0) return;
    if (this.queue.length > 0 || this.speaking || this.webSpeakPending) return;
    this.queue.push(cue);
    this.pump();
  }

  speakKey(key: string, priority: CoachPriority, id?: string, repIndex?: number) {
    this.enqueue({
      id: id || key,
      key,
      priority,
      createdAt: Date.now(),
      repIndex: repIndex ?? this.currentRep,
    });
  }

  clear() {
    this.queue = [];
    this.pumpGeneration += 1;
    if (this.speakWatchdog) {
      clearTimeout(this.speakWatchdog);
      this.speakWatchdog = null;
    }
    stopAllSpeech();
    this.speaking = false;
    this.webSpeakPending = false;
    this.currentKey = null;
    this.currentPriority = null;
    this.emit();
  }

  private finishUtterance() {
    if (this.speakWatchdog) {
      clearTimeout(this.speakWatchdog);
      this.speakWatchdog = null;
    }
    this.speaking = false;
    this.webSpeakPending = false;
    this.lastSpokeAt = Date.now();
    this.currentKey = null;
    this.currentPriority = null;
    this.emit();
    this.pump();
  }

  private speakWeb(text: string, lang: string, gen: number) {
    const synth = getSynth();
    if (!synth) {
      this.finishUtterance();
      return;
    }

    void (async () => {
      const voicesFromWait = await ensureVoicesReady();
      if (gen !== this.pumpGeneration) return;

      // Always settle cancel before speak on Chromium — prevents dropped utterances
      await stopWebSpeech();
      if (gen !== this.pumpGeneration) return;

      // Fresh voice list at speak-time (never trust a cached empty array)
      const voices = synth.getVoices().length > 0 ? synth.getVoices() : voicesFromWait;
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = lang;
      utter.volume = 1;
      utter.rate = 1;
      const voice = pickVoice(voices, lang);
      if (voice) utter.voice = voice;

      const clearWatchdog = () => {
        if (this.speakWatchdog) {
          clearTimeout(this.speakWatchdog);
          this.speakWatchdog = null;
        }
      };

      utter.onstart = () => {
        clearWatchdog();
        console.log("[WebTTS] onstart", {
          text,
          unlocked: webAudioUnlocked,
          voice: voice?.name || null,
        });
        this.webSpeakPending = false;
        this.speaking = true;
        this.emit();
      };
      utter.onend = () => {
        clearWatchdog();
        console.log("[WebTTS] onend", { text });
        this.finishUtterance();
      };
      utter.onerror = (ev) => {
        clearWatchdog();
        console.error("[WebTTS] onerror", {
          text,
          error: ev.error,
          unlocked: webAudioUnlocked,
          voices: voices.length,
        });
        this.finishUtterance();
      };

      console.log("[WebTTS] before speak", {
        text,
        lang,
        voice: voice?.name || null,
        speaking: synth.speaking,
        pending: synth.pending,
        paused: synth.paused,
        voices: voices.length,
        unlocked: webAudioUnlocked,
      });

      if (!webAudioUnlocked) {
        console.warn(
          "[WebTTS] speak without unlockWebSpeech() — browser may silently block (tap Voice / Test Audio)",
        );
      }

      if (voices.length === 0) {
        console.warn("[WebTTS] getVoices() still empty at speak-time");
      }

      try {
        if (synth.paused) synth.resume();
        synth.speak(utter);
        // Chromium sometimes parks the utterance as paused immediately
        if (synth.paused) synth.resume();
        setTimeout(() => {
          if (gen === this.pumpGeneration && synth.paused) synth.resume();
        }, 40);
      } catch (err) {
        console.error("[WebTTS] speak() threw", err);
        this.finishUtterance();
        return;
      }

      // If neither start nor error fires (silent browser drop), unblock the queue
      this.speakWatchdog = setTimeout(() => {
        if (gen !== this.pumpGeneration) return;
        if (this.speaking) return;
        console.error("[WebTTS] watchdog — no onstart after speak(); resetting queue", {
          unlocked: webAudioUnlocked,
          speaking: synth.speaking,
          pending: synth.pending,
          paused: synth.paused,
        });
        try {
          synth.cancel();
        } catch {
          // ignore
        }
        this.finishUtterance();
      }, SPEAK_WATCHDOG_MS);
    })();
  }

  private pump() {
    if (this.speaking || this.webSpeakPending || this.opts.muted) return;
    const now = Date.now();
    if (now - this.lastSpokeAt < MIN_UTTERANCE_GAP_MS) {
      setTimeout(() => this.pump(), MIN_UTTERANCE_GAP_MS - (now - this.lastSpokeAt));
      return;
    }
    const next = this.queue.shift();
    if (!next) return;

    const text = String(
      i18n.t(`aiTrainer.${next.key}`, {
        defaultValue: i18n.t(next.key, { defaultValue: next.key }),
      }),
    );
    const lang = this.opts.lang || speechLocaleForAppLang(i18n.language);
    this.currentKey = next.key;
    this.currentPriority = next.priority;

    const gen = this.pumpGeneration;

    if (webSpeechAvailable()) {
      // Banner can update; speaking flag waits for onstart
      this.webSpeakPending = true;
      this.speaking = false;
      this.emit();
      this.speakWeb(text, lang, gen);
      return;
    }

    this.speaking = true;
    this.emit();

    Speech.speak(text, {
      language: lang,
      onStart: () => {
        this.speaking = true;
        this.emit();
      },
      onDone: () => this.finishUtterance(),
      onStopped: () => {
        this.speaking = false;
        this.webSpeakPending = false;
        this.lastSpokeAt = Date.now();
        this.currentKey = null;
        this.currentPriority = null;
        this.emit();
      },
      onError: () => this.finishUtterance(),
    });
  }
}

export const sharedAudioCoach = new AudioCoachQueue();

export function nextVoiceMode(current: VoiceMode): VoiceMode {
  if (current === "full") return "corrections_only";
  if (current === "corrections_only") return "muted";
  return "full";
}

export function voiceModeLabel(mode: VoiceMode): string {
  if (mode === "full") return "🔊 Full";
  if (mode === "corrections_only") return "🔈 Fixes";
  return "🔇 Mute";
}
