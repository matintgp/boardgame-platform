"use client";

/**
 * Real chess sound effects (chess.com-style set) served from /sounds.
 * Audio elements are cached and cloned on play so rapid moves overlap cleanly.
 */

const FILES = {
  moveSelf: "/sounds/move-self.mp3",
  moveOpponent: "/sounds/move-opponent.mp3",
  capture: "/sounds/capture.mp3",
  check: "/sounds/move-check.mp3",
  end: "/sounds/game-end.mp3",
} as const;

type SoundKey = keyof typeof FILES;
const cache = new Map<SoundKey, HTMLAudioElement>();

function base(key: SoundKey): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  let el = cache.get(key);
  if (!el) {
    el = new Audio(FILES[key]);
    el.preload = "auto";
    cache.set(key, el);
  }
  return el;
}

function play(key: SoundKey, volume = 1) {
  const src = base(key);
  if (!src) return;
  // Clone so overlapping plays (fast moves) don't cut each other off.
  const inst = src.cloneNode(true) as HTMLAudioElement;
  inst.volume = volume;
  void inst.play().catch(() => undefined);
}

export function playMoveSound(isOwnMove: boolean) {
  play(isOwnMove ? "moveSelf" : "moveOpponent", isOwnMove ? 1 : 0.8);
}

export function playCaptureSound() {
  play("capture");
}

export function playCheckSound() {
  play("check");
}

export function playGameEndSound() {
  play("end");
}
