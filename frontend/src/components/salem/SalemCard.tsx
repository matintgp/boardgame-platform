"use client";

import type { CSSProperties, ReactNode } from "react";
import { accusationValue } from "./catalog";

export type SalemCardColor = "green" | "blue" | "red" | "black";
export type SalemCardFace =
  | "tryal-back"
  | "witch"
  | "not-witch"
  | "constable"
  | "play";

export interface SalemCardProps {
  face?: SalemCardFace;
  color?: SalemCardColor;
  flipped?: boolean;
  selected?: boolean;
  compact?: boolean;
  title?: string;
  text?: string;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  disabled?: boolean;
  card?: { id: string; color?: SalemCardColor; title?: string; text?: string };
}

function TryalBack() {
  return (
    <svg viewBox="0 0 90 126" className="h-full w-full" aria-hidden>
      <defs>
        <radialGradient id="tb" cx="50%" cy="42%" r="70%">
          <stop offset="0%" stopColor="#2c1a52" />
          <stop offset="100%" stopColor="#0a0614" />
        </radialGradient>
      </defs>
      <rect width="90" height="126" rx="7" fill="url(#tb)" />
      <rect x="5" y="5" width="80" height="116" rx="5" fill="none" stroke="#d4a24e" strokeWidth="1.2" />
      <rect x="9" y="9" width="72" height="108" rx="3" fill="none" stroke="#8a6a32" strokeWidth="0.5" />
      <circle cx="45" cy="58" r="22" fill="none" stroke="#d4a24e" strokeWidth="1.1" />
      <circle cx="45" cy="58" r="16" fill="none" stroke="#c4a24e" strokeWidth="0.6" strokeDasharray="2 2.4" />
      <path
        d="M45 38 L48 54 L64 54 L51 64 L56 80 L45 70 L34 80 L39 64 L26 54 L42 54 Z"
        fill="#c4a24e"
        opacity="0.92"
      />
      <text
        x="45"
        y="102"
        textAnchor="middle"
        fill="#e8d5a0"
        fontFamily="Palatino, Georgia, serif"
        fontSize="9"
        letterSpacing="2.4"
      >
        1692
      </text>
      <text
        x="45"
        y="22"
        textAnchor="middle"
        fill="#c4a24e"
        fontFamily="Palatino, Georgia, serif"
        fontSize="7"
        letterSpacing="3"
      >
        TRYAL
      </text>
    </svg>
  );
}

function WitchMark() {
  return (
    <svg viewBox="0 0 90 70" className="mx-auto mt-1 h-16 w-full" aria-hidden>
      <circle cx="48" cy="34" r="16" fill="none" stroke="#c44545" strokeWidth="1.6" />
      <path d="M40 18c-12 4-18 14-16 26 8-2 18-8 24-20-4-4-6-6-8-6z" fill="#1a0c14" stroke="#e8d5a0" strokeWidth="1.3" />
      <path d="M28 58 L45 22 L62 58 Z" fill="none" stroke="#c44545" strokeWidth="1.2" />
    </svg>
  );
}

function NotWitchMark() {
  return (
    <svg viewBox="0 0 90 70" className="mx-auto mt-1 h-16 w-full" aria-hidden>
      <circle cx="45" cy="34" r="14" fill="none" stroke="#3d5c38" strokeWidth="1.5" />
      <path d="M45 12 L48 28 L64 28 L51 38 L56 54 L45 44 L34 54 L39 38 L26 28 L42 28 Z" fill="#3d5c38" opacity="0.85" />
      <circle cx="45" cy="34" r="5" fill="#e6d3a8" />
    </svg>
  );
}

function ConstableMark() {
  return (
    <svg viewBox="0 0 90 70" className="mx-auto mt-1 h-16 w-full" aria-hidden>
      <polygon
        points="45,10 62,20 62,42 45,58 28,42 28,20"
        fill="#1c1430"
        stroke="#d4a24e"
        strokeWidth="1.4"
      />
      <rect x="42" y="22" width="6" height="22" rx="1" fill="#c4a06a" transform="rotate(-28 45 33)" />
      <rect x="32" y="18" width="22" height="8" rx="1.4" fill="#e6c98a" transform="rotate(-28 43 22)" />
    </svg>
  );
}

function PlayMark({ color }: { color: SalemCardColor }) {
  if (color === "green") {
    return (
      <svg viewBox="0 0 90 48" className="mx-auto h-10 w-full" aria-hidden>
        <path d="M22 30c8-14 14-18 23-18 4 10 2 16-4 22" fill="none" stroke="#355c38" strokeWidth="1.6" />
        <path d="M40 16c6 2 14 4 18 12" fill="none" stroke="#355c38" strokeWidth="1.3" />
        <ellipse cx="28" cy="32" rx="5" ry="3" fill="#355c38" transform="rotate(-30 28 32)" />
      </svg>
    );
  }
  if (color === "blue") {
    return (
      <svg viewBox="0 0 90 48" className="mx-auto h-10 w-full" aria-hidden>
        <path d="M45 10c10 12 16 18 16 26a16 16 0 1 1-32 0c0-8 6-14 16-26z" fill="#2f6a88" />
        <circle cx="45" cy="32" r="5" fill="#7ec8e8" opacity="0.7" />
      </svg>
    );
  }
  if (color === "red") {
    return (
      <svg viewBox="0 0 90 48" className="mx-auto h-10 w-full" aria-hidden>
        <circle cx="45" cy="24" r="14" fill="#9a1c2a" stroke="#d4a24e" strokeWidth="1.2" />
        <path d="M45 14l1.6 5 5.2.1-4.1 3.2 1.4 5L45 24.2 36.9 27.3l1.4-5-4.1-3.2 5.2-.1z" fill="#f0d9a0" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 90 48" className="mx-auto h-10 w-full" aria-hidden>
      <path d="M50 10c-10 2-18 10-18 20s8 18 18 20c-11 0-22-8-22-20S39 10 50 10z" fill="#cfd2ee" />
    </svg>
  );
}

const FACE_CAPTION: Record<Exclude<SalemCardFace, "play" | "tryal-back">, string> = {
  witch: "WITCH",
  "not-witch": "NOT A WITCH",
  constable: "CONSTABLE",
};

export default function SalemCard({
  face,
  color,
  flipped = false,
  selected = false,
  compact = false,
  title,
  text,
  className = "",
  style,
  onClick,
  disabled,
  card,
}: SalemCardProps) {
  const resolvedFace = face ?? (card ? "play" : "tryal-back");
  const resolvedColor = color ?? card?.color ?? "green";
  const resolvedTitle = title ?? card?.title;
  const resolvedText = text ?? card?.text;
  const showFront = flipped && resolvedFace !== "tryal-back";
  const colorClass = resolvedFace === "play" || resolvedColor ? `is-${resolvedColor}` : "";
  let front: ReactNode;
  if (resolvedFace === "witch") {
    front = (
      <>
        <WitchMark />
        <span className="salem-card-title text-center tracking-wide">{resolvedTitle ?? FACE_CAPTION.witch}</span>
        {resolvedText && <span className="salem-card-text text-center">{resolvedText}</span>}
      </>
    );
  } else if (resolvedFace === "not-witch") {
    front = (
      <>
        <NotWitchMark />
        <span className="salem-card-title text-center tracking-wide">{resolvedTitle ?? FACE_CAPTION["not-witch"]}</span>
        {resolvedText && <span className="salem-card-text text-center">{resolvedText}</span>}
      </>
    );
  } else if (resolvedFace === "constable") {
    front = (
      <>
        <ConstableMark />
        <span className="salem-card-title text-center tracking-wide">{resolvedTitle ?? FACE_CAPTION.constable}</span>
        {resolvedText && <span className="salem-card-text text-center">{resolvedText}</span>}
      </>
    );
  } else {
    const marks = card?.id ? accusationValue(card.id) : 0;
    front = (
      <>
        {marks > 0 && (
          <span className="salem-card-marks" aria-hidden>
            {Array.from({ length: marks }).map((_, mi) => (
              <i key={mi} className="salem-card-mark" />
            ))}
          </span>
        )}
        <PlayMark color={resolvedColor} />
        {resolvedTitle && (
          <span className="salem-card-band">
            <span className="salem-card-title">{resolvedTitle}</span>
          </span>
        )}
        {resolvedText && <span className="salem-card-text">{resolvedText}</span>}
      </>
    );
  }

  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      className={`salem-card salem-card-3d ${colorClass} ${showFront ? "is-flipped" : ""} ${
        selected ? "is-selected" : ""
      } ${compact ? "is-compact" : ""} ${className}`}
      style={style}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      <div className="salem-card-inner">
        <div className="salem-card-face salem-card-back">
          <TryalBack />
        </div>
        <div className={`salem-card-face salem-card-front flex flex-col ${colorClass}`}>
          <div className="flex h-full flex-col p-2">{front}</div>
        </div>
      </div>
    </Tag>
  );
}


export function SalemTryalCard({
  kind,
  label,
  onClick,
}: {
  kind?: "witch" | "town" | "constable" | "innocent" | null;
  label: string;
  index?: number;
  onClick?: () => void;
}) {
  const face =
    kind === "witch" ? "witch" : kind === "constable" ? "constable" : kind ? "not-witch" : "tryal-back";
  return (
    <SalemCard
      face={face}
      flipped={Boolean(kind)}
      compact
      title={label}
      onClick={onClick}
      className="salem-tryal-card"
    />
  );
}
