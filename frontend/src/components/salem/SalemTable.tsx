"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { hallPortrait, playCardInfo, tryalKindFromId, townHallI18nKey } from "./catalog";
import {
  MARK_THRESHOLD,
  bluesOf,
  isSeatAlive,
  marksOf,
  polarOval,
  townHallOf,
  tryalsOf,
  type PlayerInfo,
  type SalemPhase,
  type SalemState,
  type TryalKind,
} from "./types";

type Slot = { seat: number; player: PlayerInfo | null };

/** Seat portrait that degrades to a parchment initial-crest when the asset 404s. */
function SeatPortrait({ hallId, name }: { hallId: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const src = hallPortrait(hallId);
  if (!src || failed) {
    return (
      <span className="salem-portrait salem-portrait-fallback" aria-hidden>
        {(name.trim().slice(0, 1) || "?").toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className="salem-portrait"
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export default function SalemTable({
  slots,
  state,
  phase,
  youSeat,
  userId,
  selected,
  targetable,
  actionLabel,
  youMarker,
  emptyLabel,
  deadLabel,
  accusationsLabel,
  deckLabel = "Deck",
  discardLabel = "Discard",
  hourglass = false,
  hourglassSeconds = 0,
  hourglassLabel,
  onActivate,
  onReport,
  showWitchMarks,
  teammates,
}: {
  slots: Slot[];
  state: SalemState | null;
  phase: SalemPhase | null;
  youSeat: number | null;
  userId: string | undefined;
  selected: number | null;
  targetable: (seat: number) => boolean;
  actionLabel: string;
  youMarker: string;
  emptyLabel: string;
  deadLabel: string;
  accusationsLabel: string;
  deckLabel?: string;
  discardLabel?: string;
  hourglass?: boolean;
  hourglassSeconds?: number;
  hourglassLabel?: string;
  onActivate: (seat: number) => void;
  onReport: (p: PlayerInfo) => void;
  showWitchMarks: boolean;
  teammates: number[];
}) {
  const t = useTranslations("salem");
  const n = slots.length;
  const crowded = n >= 10;
  const intimate = n > 0 && n <= 6;
  const tableClass =
    phase === "night" || phase === "confess"
      ? "is-night"
      : phase === "dawn"
        ? "is-dawn"
        : phase === "conspiracy"
          ? "is-conspiracy is-dawn"
          : phase === "day" || phase === "town_hall"
            ? "is-day is-turn"
            : phase === "over"
              ? "is-over"
              : "";

  const marksTotal = state
    ? Object.values(state.marks ?? {}).reduce((a, b) => a + (Number(b) || 0), 0)
    : 0;
  const chips = Math.max(0, Math.min(7, marksTotal));
  const sand = String(Math.max(0, Math.min(1, hourglassSeconds / 30)));
  const rx = crowded ? 41 : n > 8 ? 40 : 42;
  const ry = crowded ? 33 : n > 8 ? 32 : 34;

  return (
    <div
      className={`salem-table mx-auto aspect-[5/4] w-full ${crowded ? "is-crowded" : intimate ? "is-intimate max-w-[min(34rem,calc(54vh*5/4))]" : "max-w-[min(37rem,calc(56vh*5/4))]"} ${tableClass}`}
      dir="ltr"
    >
      <div className="salem-table-felt" />
      <div className="salem-night-fog" aria-hidden />
      <div className="salem-dawn-glow" aria-hidden />
      <div className="salem-table-vignette" aria-hidden />
      <div className="salem-candle salem-candle-left" aria-hidden>
        <span className="salem-flame" />
        <span className="salem-wick" />
        <span className="salem-holder" />
      </div>
      <div className="salem-candle salem-candle-right" aria-hidden>
        <span className="salem-flame" />
        <span className="salem-wick" />
        <span className="salem-holder" />
      </div>

      <div className="salem-zone salem-zone-deck">
        <div className="salem-deck-stack" aria-hidden />
        <span className="salem-zone-label">
          {deckLabel}
          {state ? ` · ${state.deck_left}` : ""}
        </span>
      </div>
      <div className="salem-zone salem-zone-discard">
        <div className="salem-discard-slot" aria-hidden />
        <span className="salem-zone-label">
          {discardLabel}
          {state?.discard_top ? ` · ${playCardInfo(state.discard_top).title}` : ""}
        </span>
      </div>
      <div className="salem-zone salem-zone-accuse">
        <div className={`salem-accusation ${chips > 0 ? "is-grow" : ""}`}>
          {Array.from({ length: Math.min(4, chips) }).map((_, i) => (
            <span key={i} className="salem-accusation-chip" />
          ))}
        </div>
        <span className="salem-zone-label">
          {accusationsLabel}
          {state ? ` · ${marksTotal}` : ""}
        </span>
      </div>
      <div className={`salem-gavel-token ${phase === "night" ? "is-strike" : ""}`} aria-hidden>
        <img src="/salem/icons/gavel.svg" alt="" />
      </div>
      {(hourglass || phase === "dawn" || phase === "town_hall") && (
        <div className="salem-hourglass-wrap" aria-live={hourglass ? "polite" : "off"}>
          <div
            className={`salem-hourglass ${hourglass ? "" : "is-idle"}`}
            style={{ ["--sand" as string]: hourglass ? sand : "1" }}
            aria-hidden
          >
            <div className="salem-hourglass-frame" />
            <div className="salem-hourglass-sand-top" />
            <div className="salem-hourglass-stream" />
            <div className="salem-hourglass-sand-bot" />
          </div>
          {hourglassLabel && <span className="salem-hourglass-label">{hourglassLabel}</span>}
        </div>
      )}

      <div className="pointer-events-none absolute inset-[34%] z-0 flex flex-col items-center justify-center text-center">
        <span className="salem-center-icon" aria-hidden>
          {phase === "night" || phase === "confess"
            ? "☾"
            : phase === "dawn"
              ? "☽"
              : phase === "conspiracy"
                ? "↻"
                : phase === "over"
                  ? "⚖"
                  : "🕯"}
        </span>
      </div>
      {slots.map((slot, i) => {
        const pos = polarOval(i, n, rx, ry);
        const p = slot.player;
        const hall = townHallOf(state, slot.seat);
        const isSelf =
          p ? p.user.id === userId || slot.seat === youSeat : slot.seat === youSeat;
        const alive = p ? isSeatAlive(state, slot.seat) : true;
        const picked = selected === slot.seat;
        const canHit = p != null && targetable(slot.seat);
        const mate = showWitchMarks && teammates.includes(slot.seat);
        const current = state?.current_seat === slot.seat && phase === "day";
        const blues = bluesOf(state, slot.seat);
        const catHere = blues.includes("black_cat");
        const pubTryals = tryalsOf(state, slot.seat);
        const acc = marksOf(state, slot.seat);

        const chip = (
          <div className={`salem-seat ${!alive ? "is-dead" : ""} ${current ? "is-current" : ""}`}>
            <span
              className={`salem-avatar ${
                picked ? "is-picked" : isSelf ? "is-self" : mate ? "is-mate" : p ? "" : "is-empty"
              } ${canHit ? "is-target" : ""}`}
            >
              {hall && hallPortrait(hall.id) ? (
                <SeatPortrait hallId={hall.id} name={t(`halls.${townHallI18nKey(hall.id)}`)} />
              ) : (
                p ? (p.user.username.slice(0, 1) || "?").toUpperCase() : "·"
              )}
              {!alive && <span className="salem-dead-mark">✝</span>}
              {catHere && <img className="salem-cat-badge" src="/salem/icons/cat.svg" alt="" />}
            </span>
            <span className="salem-name" title={p?.user.username}>
              {p ? p.user.username : emptyLabel}
            </span>
            {isSelf && p && <em className="salem-you">{youMarker}</em>}
            {!alive && p && <em className="salem-dead-label">— {deadLabel}</em>}
            {hall && (
              <span
                className="salem-nameplate"
                title={t(`hallRoles.${townHallI18nKey(hall.id)}`)}
              >
                {t(`halls.${townHallI18nKey(hall.id)}`)}
              </span>
            )}
            {p && phase != null && (
              <div className="salem-tryals" aria-hidden>
                {pubTryals.revealed.map((id, ti) => {
                  const kind: TryalKind = tryalKindFromId(id);
                  const cls = kind === "innocent" ? "is-town is-innocent" : `is-${kind}`;
                  return (
                    <span
                      key={`r-${ti}-${id}`}
                      className={`salem-tryal ${cls}`}
                      style={{ animationDelay: `${ti * 60}ms` }}
                    />
                  );
                })}
                {Array.from({ length: pubTryals.facedown }).map((_, ti) => (
                  <span
                    key={`h-${ti}`}
                    className="salem-tryal is-hidden"
                    style={{ animationDelay: `${(pubTryals.revealed.length + ti) * 60}ms` }}
                  />
                ))}
                {Array.from({
                  length: Math.max(0, 5 - pubTryals.revealed.length - pubTryals.facedown),
                }).map((_, ti) => (
                  <span key={`e-${ti}`} className="salem-tryal is-empty" />
                ))}
              </div>
            )}
            {p && phase != null && (
              <div className="salem-wax-row" title={`${accusationsLabel} ${acc}/${MARK_THRESHOLD}`}>
                {Array.from({ length: MARK_THRESHOLD }).map((_, wi) => (
                  <span key={wi} className={`salem-wax ${wi < acc ? "is-lit" : ""}`} />
                ))}
              </div>
            )}
            {blues.length > 0 && (
              <div className="salem-blues">
                {blues.map((id, bi) => (
                  <span key={`${id}-${bi}`} className="salem-blue-chip" title={playCardInfo(id).title}>
                    {playCardInfo(id).title}
                  </span>
                ))}
              </div>
            )}
            {canHit && actionLabel && <span className="salem-action-hint">{actionLabel}</span>}
          </div>
        );

        return (
          <div
            key={p ? `p-${p.seat}` : `empty-${slot.seat}`}
            className="absolute z-[5] -translate-x-1/2 -translate-y-1/2"
            style={pos}
          >
            {canHit ? (
              <button
                type="button"
                onClick={() => onActivate(slot.seat)}
                aria-label={`${p?.user.username ?? slot.seat} ${actionLabel}`}
                className="bg-transparent"
              >
                {chip}
              </button>
            ) : (
              chip
            )}
            {p && !isSelf && (
              <button
                type="button"
                className="btn btn-ghost mx-auto mt-0.5 !px-1.5 !py-0 text-[10px]"
                title="Report"
                onClick={(e) => {
                  e.stopPropagation();
                  onReport(p);
                }}
              >
                ⚑
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
