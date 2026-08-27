"use client";

/**
 * Short local SFX for the Salem table. Never throws if autoplay is blocked.
 * Files live in /salem/sounds/.
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

const cache = new Map<SalemSound, HTMLAudioElement>();

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

export function playSalemSound(key: SalemSound, volume = 1) {
  const src = base(key);
  if (!src) return;
  const inst = src.cloneNode(true) as HTMLAudioElement;
  inst.volume = Math.max(0, Math.min(1, volume));
  void inst.play().catch(() => undefined);
}

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
