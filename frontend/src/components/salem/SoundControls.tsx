"use client";

/**
 * Compact sound controls for the Salem table: mute toggle + volume slider.
 * State lives in salemSounds.ts (localStorage-backed) and is mirrored here
 * via useSyncExternalStore. Class hooks are prefixed `salem-sound-` so the
 * Salem stylesheet can restyle them; Tailwind utilities provide the base look.
 */

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import {
  getSalemVolume,
  isSalemMuted,
  setSalemMuted,
  setSalemVolume,
  subscribeSalemSoundSettings,
} from "./salemSounds";

function useSoundSettings() {
  const volume = useSyncExternalStore(
    subscribeSalemSoundSettings,
    getSalemVolume,
    getSalemVolume,
  );
  const muted = useSyncExternalStore(
    subscribeSalemSoundSettings,
    isSalemMuted,
    isSalemMuted,
  );
  return { volume, muted };
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      {muted ? (
        <>
          <line x1="22" y1="9" x2="16" y2="15" />
          <line x1="16" y1="9" x2="22" y2="15" />
        </>
      ) : (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </>
      )}
    </svg>
  );
}

export default function SoundControls() {
  const t = useTranslations("salem");
  const { volume, muted } = useSoundSettings();

  return (
    <div
      className="salem-sound-controls flex items-center gap-2 rounded-md border border-amber-900/40 bg-stone-900/70 px-2 py-1 text-amber-100/90 shadow-sm"
      aria-label={t("soundLabel")}
    >
      <button
        type="button"
        className="salem-sound-toggle flex h-7 w-7 items-center justify-center rounded hover:bg-amber-100/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-300/60"
        onClick={() => setSalemMuted(!muted)}
        aria-label={muted ? t("soundUnmute") : t("soundMute")}
        aria-pressed={muted}
        title={muted ? t("soundUnmute") : t("soundMute")}
      >
        <SpeakerIcon muted={muted} />
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(volume * 100)}
        onChange={(e) => setSalemVolume(Number(e.target.value) / 100)}
        className="salem-sound-slider h-1 w-20 cursor-pointer accent-amber-400"
        aria-label={t("soundVolume")}
        title={t("soundVolume")}
      />
    </div>
  );
}
