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
  /** Suit band caption (e.g. localized color.<suit>). Play face only. */
  suitLabel?: string;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  disabled?: boolean;
  card?: { id: string; color?: SalemCardColor; title?: string; text?: string };
}

/** Monochrome stroke emblems per engine card id (24×24, stroke set from CSS). */
const EMBLEMS: Record<string, ReactNode> = {
  // Writ — wax seal medallion with ribbons
  accusation: (
    <>
      <circle cx="12" cy="9" r="5.5" />
      <path d="M8.5 13.5 6 21l6-2.6L18 21l-2.5-7.5" />
    </>
  ),
  // Proof — sealed scroll
  evidence: (
    <>
      <rect x="6" y="4" width="12" height="16" rx="2" />
      <path d="M9 9h6M9 13h6M9 17h4" />
    </>
  ),
  // Oath — quill
  witness: (
    <>
      <path d="M20 4c-5 0-10 4-12 9l-3 7 7-3c5-2 9-7 8-13z" />
      <path d="M8 16 15 8" />
    </>
  ),
  // Clean Hands — droplet
  alibi: (
    <>
      <path d="M12 3c3.2 4.2 6 7.2 6 10.2a6 6 0 1 1-12 0C6 10.2 8.8 7.2 12 3z" />
      <path d="M9.5 13.5a2.6 2.6 0 0 0 2 2.6" />
    </>
  ),
  // Hearthfire — flame
  arson: (
    <>
      <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-2.5-5.5C15 8 13 6 12 2c-1 4-3 6-4.5 7.5C6 11 5 13 5 15a7 7 0 0 0 7 7z" />
      <path d="M12 22a3.5 3.5 0 0 0 3.5-3.5c0-1.5-1.5-3-3.5-5-2 2-3.5 3.5-3.5 5A3.5 3.5 0 0 0 12 22z" />
    </>
  ),
  // Cutpurse — coin purse
  robbery: (
    <>
      <path d="M9 7h6l1.2 3.2a6.2 6.2 0 1 1-8.4 0L9 7z" />
      <path d="M9 7a3 3 0 0 1 6 0" />
      <path d="M10 14.5h4" />
    </>
  ),
  // Shifted Blame — opposing arrows
  scapegoat: <path d="M4 8h11.5L12 4.5M20 16H8.5L12 19.5" />,
  // Pillory — posts with holed bar
  stocks: (
    <>
      <path d="M5 21V4M19 21V4M3 8h18" />
      <circle cx="9.5" cy="8" r="1.7" />
      <circle cx="14.5" cy="8" r="1.7" />
    </>
  ),
  // Hex — hex sign
  curse: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 6.5v11M7.2 9.2l9.6 5.6M16.8 9.2l-9.6 5.6" />
    </>
  ),
  // Night Familiar — cat face
  black_cat: (
    <>
      <path d="M5.5 9.5 7 4l3.5 2.8h3L17 4l1.5 5.5a6.8 6.8 0 1 1-13 0z" />
      <circle cx="10" cy="13" r=".4" />
      <circle cx="14" cy="13" r=".4" />
    </>
  ),
  // The Turning — circular arrows
  conspiracy: (
    <>
      <path d="M4.5 12a7.5 7.5 0 0 1 13-5.2M19.5 12a7.5 7.5 0 0 1-13 5.2" />
      <path d="M17.5 2.8v4h-4M6.5 21.2v-4h4" />
    </>
  ),
  // Nightfall — crescent moon
  night: <path d="M20 13.5A8 8 0 0 1 10.5 4 6.5 6.5 0 1 0 20 13.5z" />,
};

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
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M6 15c2.5-4.5 4.5-6 7.5-6 1.4 3.2.7 5.2-1.3 7.2" />
        <path d="M11.5 10.5c2 .7 4.5 1.4 6 4" />
      </svg>
    );
  }
  if (color === "blue") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M12 3c2.7 3.2 4.3 4.8 4.3 7a4.3 4.3 0 1 1-8.6 0c0-2.2 1.6-3.8 4.3-7z" />
      </svg>
    );
  }
  if (color === "red") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="7.5" />
        <path d="M12 7.5l1 3 3.2.1-2.5 2 .9 3-2.6-1.8-2.6 1.8.9-3-2.5-2 3.2-.1z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M20 13.5A8 8 0 0 1 10.5 4 6.5 6.5 0 1 0 20 13.5z" />
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
  suitLabel,
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
        {suitLabel && <span className="salem-card-band">{suitLabel}</span>}
        <span className="salem-card-emblem" aria-hidden>
          {card?.id && EMBLEMS[card.id] ? (
            <svg viewBox="0 0 24 24">{EMBLEMS[card.id]}</svg>
          ) : (
            <PlayMark color={resolvedColor} />
          )}
        </span>
        {resolvedTitle && <span className="salem-card-title">{resolvedTitle}</span>}
        {resolvedText && <span className="salem-card-text">{resolvedText}</span>}
        {marks > 0 && (
          <span className="salem-card-marks" aria-hidden>
            {Array.from({ length: marks }).map((_, mi) => (
              <i key={mi} className="salem-card-mark" />
            ))}
          </span>
        )}
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
        <div className={`salem-card-face salem-card-front ${colorClass}`}>
          <div className="salem-card-paper">{front}</div>
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
