"use client";

import type { ReactNode } from "react";

export interface SalemTableFeltProps {
  night?: boolean;
  dawn?: boolean;
  pileCount?: number;
  accusationCount?: number;
  hourglass?: boolean;
  hourglassSeconds?: number;
  children?: ReactNode;
  className?: string;
  deckLabel?: string;
  discardLabel?: string;
  pileLabel?: string;
}

function Candle({ className = "" }: { className?: string }) {
  return (
    <div className={`salem-candle ${className}`} aria-hidden>
      <span className="salem-flame" />
      <span className="salem-wick" />
      <span className="salem-holder" />
    </div>
  );
}

export default function SalemTableFelt({
  night = false,
  dawn = false,
  pileCount = 0,
  accusationCount,
  hourglass = false,
  hourglassSeconds = 30,
  children,
  className = "",
  deckLabel = "Deck",
  discardLabel = "Discard",
  pileLabel = "Seals",
}: SalemTableFeltProps) {
  const phase = night ? "is-night" : dawn ? "is-dawn" : "is-turn";
  const chips = Math.max(0, Math.min(4, accusationCount ?? pileCount));
  const sand = String(Math.max(0, Math.min(1, hourglassSeconds / 30)));

  return (
    <div className={`salem-table salem-felt-shell aspect-[5/4] w-full ${phase} ${className}`}>
      <div className="salem-table-felt" />
      <div className="salem-night-fog" aria-hidden />
      <Candle />
      <Candle className="salem-candle-left" />
      <Candle className="salem-candle-right" />

      <div className="salem-zone salem-zone-deck">
        <div className="salem-deck-stack" aria-hidden />
        <span className="salem-zone-label">{deckLabel}</span>
      </div>
      <div className="salem-zone salem-zone-discard">
        <div className="salem-discard-slot" aria-hidden />
        <span className="salem-zone-label">{discardLabel}</span>
      </div>
      <div className="salem-zone salem-zone-accuse">
        <div className={`salem-accusation ${chips > 0 ? "is-grow" : ""}`}>
          {Array.from({ length: chips }).map((_, i) => (
            <span key={i} className="salem-accusation-chip" />
          ))}
        </div>
        <span className="salem-zone-label">{pileLabel}</span>
      </div>

      <div className="salem-gavel-token" aria-hidden>
        <img src="/salem/icons/gavel.svg" alt="" />
      </div>

      {hourglass && (
        <div
          className="salem-hourglass"
          style={{
            position: "absolute",
            zIndex: 4,
            insetInlineStart: "16%",
            bottom: "16%",
            ["--sand" as string]: sand,
          }}
          aria-hidden
        >
          <div className="salem-hourglass-frame" />
          <div className="salem-hourglass-sand-top" />
          <div className="salem-hourglass-stream" />
          <div className="salem-hourglass-sand-bot" />
        </div>
      )}

      <div className="relative z-[4] flex h-full items-center justify-center p-[18%]">
        {children}
      </div>
    </div>
  );
}
