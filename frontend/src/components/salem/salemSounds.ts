"use client";

/**
 * Short local SFX for the Salem table. Never throws if autoplay is blocked.
 * Files live in /salem/sounds/.
 *
 * Master volume and mute are persisted in localStorage ("salem:volume",
 * "salem:muted") and shared via a tiny pub/sub so controls can re-render.
 * A one-time pointerdown/keydown listener preloads the audio elements after
 * the first user gesture to satisfy browser autoplay policies.
 */

const FILES = {
  click: "/salem/sounds/click.mp3",
  "card-flip": "/salem/sounds/flip.mp3",
  gavel: "/salem/sounds/gavel.mp3",
  "night-bell": "/salem/sounds/night.mp3",
  "confession-tick": "/salem/sounds/tick.mp3",
  wax: "/salem/sounds/wax.mp3",
} as const;

export type SalemSound = keyof typeof FILES;

const VOLUME_KEY = "salem:volume";
const MUTED_KEY = "salem:muted";
const DEFAULT_VOLUME = 0.5;

const cache = new Map<SalemSound, HTMLAudioElement>();
const listeners = new Set<() => void>();

function clamp(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function readVolume(): number {
  if (typeof window === "undefined") return DEFAULT_VOLUME;
  const raw = window.localStorage.getItem(VOLUME_KEY);
  if (raw === null) return DEFAULT_VOLUME;
  const v = Number(raw);
  return Number.isFinite(v) ? clamp(v) : DEFAULT_VOLUME;
}

function readMuted(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MUTED_KEY) === "1";
}

let volume = readVolume();
let muted = readMuted();

function emit() {
  for (const listener of listeners) listener();
}

export function getSalemVolume(): number {
  return volume;
}

export function setSalemVolume(v: number): void {
  volume = clamp(v);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(VOLUME_KEY, String(volume));
  }
  emit();
}

export function isSalemMuted(): boolean {
  return muted;
}

export function setSalemMuted(m: boolean): void {
  muted = Boolean(m);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
  }
  emit();
}

export function subscribeSalemSoundSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function base(key: SalemSound): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  let el = cache.get(key);
  if (!el) {
    el = new Audio(FILES[key]);
    el.preload = "auto";
    cache.set(key, el);
  }
  return el;
}

// One-time unlock: after the first user gesture the browser lets us preload.
let unlockArmed = false;

function armUnlock() {
  if (unlockArmed || typeof window === "undefined") return;
  unlockArmed = true;
  const unlock = () => {
    for (const key of Object.keys(FILES) as SalemSound[]) {
      base(key)?.load();
    }
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

export function playSalemSound(key: SalemSound, volume: number = 1) {
  if (typeof window === "undefined") return;
  armUnlock();
  if (muted) return;
  const src = base(key);
  if (!src) return;
  const inst = src.cloneNode(true) as HTMLAudioElement;
  inst.volume = clamp(volume) * getSalemVolume();
  void inst.play().catch(() => undefined);
}

// Arm the unlock as soon as this module runs on the client, so the first
// gesture preloads every file even before any sound is requested.
if (typeof window !== "undefined") armUnlock();

export function playSalemClick() {
  playSalemSound("click", 0.7);
}
export function playSalemCard() {
  playSalemSound("card-flip", 0.85);
}
export function playSalemGavel() {
  playSalemSound("gavel", 0.9);
}
export function playSalemNight() {
  playSalemSound("night-bell", 0.7);
}
export function playSalemReveal() {
  playSalemSound("wax", 0.9);
}
export function playSalemTick() {
  playSalemSound("confession-tick", 0.55);
}
