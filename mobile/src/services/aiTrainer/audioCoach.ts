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

/**
 * Chrome GC quirk: local SpeechSynthesisUtterance vars can be collected before
 * the engine fires events → silent speak() with no onstart/onend/onerror.
 * Keep a module-level hold until end/error.
 */
let currentUtteranceRef: SpeechSynthesisUtterance | null = null;
/** Extra set so unlock + test paths never lose an utterance mid-flight. */
const heldUtterances = new Set<SpeechSynthesisUtterance>();

function retainUtterance(utter: SpeechSynthesisUtterance): void {
  currentUtteranceRef = utter;
  heldUtterances.add(utter);
}

function releaseUtterance(utter: SpeechSynthesisUtterance): void {
  heldUtterances.delete(utter);
  if (currentUtteranceRef === utter) currentUtteranceRef = null;
}

function clearHeldUtterances(): void {
  heldUtterances.clear();
  currentUtteranceRef = null;
}

/** Chrome: synth can sit paused after idle — resume before every speak. */
function resumeSynth(synth: SpeechSynthesis): void {
  try {
    synth.resume();
  } catch {
    // ignore
  }
}

function pollSpeakingState(tag: string, synth: SpeechSynthesis): void {
  const snap = () => ({
    speaking: synth.speaking,
    pending: synth.pending,
    paused: synth.paused,
    held: heldUtterances.size,
  });
  console.log(`[${tag}] speaking poll immediate`, snap());
  for (const ms of [100, 500, 1500] as const) {
    setTimeout(() => {
      console.log(`[${tag}] speaking poll +${ms}ms`, snap());
    }, ms);
  }
}

type SpeakHeldOpts = {
  tag: string;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
};

/**
 * Assign lifecycle handlers, retain the utterance, resume + speak, poll state.
 */
function speakHeldUtterance(
  synth: SpeechSynthesis,
  utter: SpeechSynthesisUtterance,
  opts: SpeakHeldOpts,
): void {
  retainUtterance(utter);
  utter.onstart = () => {
    console.log(`[${opts.tag}] onstart`);
    opts.onStart?.();
  };
  utter.onend = () => {
    console.log(`[${opts.tag}] onend`);
    releaseUtterance(utter);
    opts.onEnd?.();
  };
  utter.onerror = (e) => {
    console.warn(`[${opts.tag}] onerror`, e.error);
    releaseUtterance(utter);
    opts.onError?.(String(e.error || "unknown"));
  };

  resumeSynth(synth);
  synth.speak(utter);
  resumeSynth(synth);
  pollSpeakingState(opts.tag, synth);
}

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

/** Mark unlocked without speaking or canceling (for Test Audio / warm-up already spoken). */
export function markWebSpeechUnlocked(): void {
  webAudioUnlocked = true;
  notifyUnlock();
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
    setTimeout(finish, 1500);
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
 * Single choke-point for speechSynthesis.cancel().
 * Never call synth.cancel() elsewhere — so we can see who cancelled what.
 */
function cancelWebSpeech(reason: string, opts?: { force?: boolean }): Promise<void> {
  const synth = getSynth();
  if (!synth) return Promise.resolve();

  const speaking = synth.speaking;
  const pending = synth.pending;
  const paused = synth.paused;
  const force = opts?.force === true;

  // Legitimate cancels only:
  // - force: session end / pause / safety interrupt / watchdog on OUR stuck speak
  // - or there is actually something to supersede
  if (!force && !speaking && !pending) {
    return Promise.resolve();
  }

  console.warn("[cancel-call]", reason, { speaking, pending, paused, force });

  try {
    synth.cancel();
  } catch {
    // ignore
  }
  clearHeldUtterances();

  return new Promise((resolve) => {
    if (cancelSettleTimer) clearTimeout(cancelSettleTimer);
    cancelSettleTimer = setTimeout(() => {
      cancelSettleTimer = null;
      resolve();
    }, 90);
  });
}

/**
 * Unlock browser TTS under the user-gesture policy.
 * Must stay synchronous in a click handler.
 * Never cancel an in-flight utterance here — that caused Test Audio "canceled" errors.
 */
export function unlockWebSpeech(): void {
  if (!webSpeechAvailable()) return;
  const synth = getSynth()!;
  void ensureVoicesReady();
  try {
    // Already speaking (e.g. Test Audio) — don't interrupt; just mark unlocked
    if (synth.speaking || synth.pending) {
      webAudioUnlocked = true;
      notifyUnlock();
      console.log("[WebTTS] unlockWebSpeech() — skip warm-up, synth busy", {
        speaking: synth.speaking,
        pending: synth.pending,
      });
      return;
    }

    const warm = new SpeechSynthesisUtterance("Coach ready");
    warm.volume = 0.35;
    warm.rate = 1.35;
    warm.pitch = 1;
    const lang = speechLocaleForAppLang(i18n.language);
    warm.lang = lang;
    const voice = pickVoice(synth.getVoices(), lang);
    if (voice) warm.voice = voice;
    console.log("[WebTTS] unlockWebSpeech() — sync speak", {
      speaking: synth.speaking,
      pending: synth.pending,
      paused: synth.paused,
      voices: synth.getVoices().length,
    });
    const markReady = () => {
      webAudioUnlocked = true;
      notifyUnlock();
    };
    speakHeldUtterance(synth, warm, {
      tag: "WebTTS unlock",
      onStart: markReady,
      onEnd: markReady,
      onError: markReady,
    });
    markReady();
  } catch (err) {
    console.warn("[WebTTS] unlockWebSpeech failed", err);
  }
}

function stopAllSpeech(reason: string): void {
  void cancelWebSpeech(reason, { force: true });
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
  console.log("[TestAudio] speakTestUtterance enter", {
    platform: Platform.OS,
    webSpeechAvailable: webSpeechAvailable(),
  });

  if (webSpeechAvailable()) {
    const synth = getSynth()!;
    const voices = synth.getVoices();
    const lang = speechLocaleForAppLang(i18n.language);
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    const voice = pickVoice(voices, lang);
    if (voice) utter.voice = voice;
    utter.volume = 1;
    console.log("[TestAudio] wrapper before speak (sync)", {
      text,
      speaking: synth.speaking,
      pending: synth.pending,
      paused: synth.paused,
      voices: voices.length,
      unlocked: webAudioUnlocked,
    });
    try {
      speakHeldUtterance(synth, utter, {
        tag: "TestAudio wrapper",
        onStart: () => console.log("[TestAudio] wrapper onstart", text),
        onEnd: () => console.log("[TestAudio] wrapper onend", text),
        onError: (error) => console.error("[TestAudio] wrapper onerror", error),
      });
      markWebSpeechUnlocked();
    } catch (err) {
      console.error("[TestAudio] wrapper speak threw", err);
    }
    return;
  }

  console.log("[TestAudio] falling through to expo-speech");
  Speech.speak(text, { language: speechLocaleForAppLang(i18n.language) });
}

/**
 * Zero-abstraction Test Audio path for the workout screen button.
 * Must hold the utterance at module scope (Chrome GC).
 */
export function speakBypassTestAudio(text = "bypass test"): boolean {
  if (!webSpeechAvailable()) return false;
  const synth = getSynth()!;
  const UtteranceCtor = (globalThis as { SpeechSynthesisUtterance: typeof SpeechSynthesisUtterance })
    .SpeechSynthesisUtterance;
  console.log("[TestAudio] synth available?", {
    hasSynth: Boolean(synth),
    hasUtterance: Boolean(UtteranceCtor),
    voices: synth.getVoices().length,
  });
  const utter = new UtteranceCtor(text);
  utter.volume = 1;
  const lang = speechLocaleForAppLang(i18n.language);
  utter.lang = lang;
  const voice = pickVoice(synth.getVoices(), lang);
  if (voice) utter.voice = voice;
  console.log("[TestAudio] calling raw speechSynthesis.speak (sync)");
  try {
    speakHeldUtterance(synth, utter, {
      tag: "TestAudio bypass",
      onStart: () => console.log("[TestAudio] bypass onstart"),
      onEnd: () => console.log("[TestAudio] bypass onend"),
      onError: (error) => console.error("[TestAudio] bypass onerror", error),
    });
    markWebSpeechUnlocked();
    return true;
  } catch (err) {
    console.error("[TestAudio] raw speak threw", err);
    return false;
  }
}

export type CoachPriority = "safety" | "correction" | "encouragement";
export type VoiceMode = "full" | "corrections_only" | "muted";

export type CoachCue = {
  id: string;
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
 * cancel() only when superseding / ending — never as a periodic no-op.
 */
export class AudioCoachQueue {
  private queue: CoachCue[] = [];
  private speaking = false;
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
        // ignore
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
      // Legitimate interrupt of whatever is speaking
      void cancelWebSpeech("safety:interrupt-lower-priority", { force: true }).then(() => {
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
      // If something is already speaking, queue and wait — do NOT cancel it
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
    stopAllSpeech("clear:session-pause-or-mute");
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

      // Never cancel here. Safety interrupts and clear() are the only cancel paths.
      // If something is already speaking (Test Audio, unlock warm-up, prior cue),
      // wait until the synth is free — cancel-before-every-speak was causing
      // onerror: "canceled" on legitimate utterances.
      if (synth.speaking || synth.pending) {
        console.log("[WebTTS] speakWeb waiting for synth free", {
          speaking: synth.speaking,
          pending: synth.pending,
          text,
        });
        setTimeout(() => {
          if (gen !== this.pumpGeneration) return;
          this.speakWeb(text, lang, gen);
        }, 200);
        return;
      }

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
          "[WebTTS] speak without unlock — tap Test Audio / Voice once to unlock",
        );
      }

      try {
        // Hold utterance at module scope so Chrome GC cannot drop it before events.
        speakHeldUtterance(synth, utter, {
          tag: "WebTTS",
          onStart: () => {
            clearWatchdog();
            console.log("[WebTTS] onstart detail", {
              text,
              unlocked: webAudioUnlocked,
              voice: voice?.name || null,
            });
            this.webSpeakPending = false;
            this.speaking = true;
            this.emit();
          },
          onEnd: () => {
            clearWatchdog();
            console.log("[WebTTS] onend detail", { text });
            this.finishUtterance();
          },
          onError: (error) => {
            clearWatchdog();
            console.error("[WebTTS] onerror detail", {
              text,
              error,
              unlocked: webAudioUnlocked,
              voices: voices.length,
            });
            this.finishUtterance();
          },
        });
        setTimeout(() => {
          if (gen === this.pumpGeneration && synth.paused) resumeSynth(synth);
        }, 40);
      } catch (err) {
        console.error("[WebTTS] speak() threw", err);
        releaseUtterance(utter);
        this.finishUtterance();
        return;
      }

      this.speakWatchdog = setTimeout(() => {
        if (gen !== this.pumpGeneration) return;
        if (this.speaking) return;
        // Only cancel if OUR pending speak never started — don't touch unrelated speech
        if (!this.webSpeakPending) return;
        console.error("[WebTTS] watchdog — no onstart after speak(); resetting queue", {
          unlocked: webAudioUnlocked,
          speaking: synth.speaking,
          pending: synth.pending,
          paused: synth.paused,
        });
        void cancelWebSpeech("watchdog:our-speak-never-started", { force: true });
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
