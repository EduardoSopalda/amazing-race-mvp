"use client";

/**
 * Tiny synthesized SFX for race events (unlock, review, verified, rejected,
 * skip, click) - no audio files, just oscillators through the Web Audio
 * API. Ported from the gab-lab-final design pack's own inline script.
 *
 * boot() must run from inside a user gesture (a click handler) - browsers
 * refuse to start an AudioContext otherwise. Call it on the first tap
 * anywhere on the page, then play() on demand; play() is a no-op until
 * boot() has run once. Starts muted for prefers-reduced-motion, otherwise
 * unmuted by default with the mute choice persisted to localStorage so it
 * survives a reload mid-race - a per-viewer UI preference, not race state,
 * so it doesn't belong on the server.
 */

export type RaceCue = "unlock" | "click" | "review" | "verified" | "rejected" | "skip" | "locked";

const STORAGE_KEY = "bcnrace_muted";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = initialMuted();

function initialMuted(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === "1";
  } catch {
    // localStorage unavailable (private mode, blocked) - fall through.
  }
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function boot(): void {
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume();
    return;
  }
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.18;
  master.connect(ctx.destination);
}

function tone(freq: number, t: number, dur: number, type: OscillatorType, gain: number): void {
  if (!ctx || !master || muted) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function play(name: RaceCue): void {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime + 0.01;
  switch (name) {
    case "unlock":
      tone(392, t, 0.09, "square", 0.08);
      tone(523.25, t + 0.1, 0.16, "square", 0.1);
      break;
    case "click":
      tone(180, t, 0.04, "square", 0.06);
      break;
    case "review":
      tone(220, t, 0.12, "triangle", 0.07);
      tone(247, t + 0.14, 0.16, "triangle", 0.06);
      break;
    case "verified":
      tone(523.25, t, 0.12, "square", 0.1);
      tone(659.25, t + 0.1, 0.12, "square", 0.1);
      tone(783.99, t + 0.2, 0.22, "square", 0.11);
      break;
    case "rejected":
      tone(196, t, 0.18, "sawtooth", 0.09);
      tone(147, t + 0.12, 0.28, "sawtooth", 0.08);
      break;
    case "skip":
      tone(130.8, t, 0.22, "triangle", 0.07);
      break;
    case "locked":
      tone(110, t, 0.2, "sine", 0.05);
      break;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Non-fatal - preference just won't persist this session.
  }
  if (master && ctx) master.gain.setTargetAtTime(value ? 0 : 0.18, ctx.currentTime, 0.03);
}
