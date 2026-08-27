"use client";

import { playCardInfo, tryalKindFromId } from "./catalog";
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
  onActivate: (seat: number) => void;
  onReport: (p: PlayerInfo) => void;
  showWitchMarks: boolean;
  teammates: number[];
}) {
  const n = slots.length;
  const tableClass =
    phase === "night" || phase === "confess"
      ? "is-night"
      : phase === "conspiracy"
        ? "is-conspiracy is-dawn"
        : phase === "day"
          ? "is-day is-turn"
          : phase === "over"
            ? "is-over"
            : "";

  return (
    <div className={`salem-table mx-auto aspect-[5/4] w-full max-w-[36rem] ${tableClass}`} dir="ltr">
      <div className="salem-table-felt" />
      <div className="salem-night-fog" aria-hidden />
      <div className="salem-candle" aria-hidden>
        <span className="salem-flame" />
        <span className="salem-wick" />
        <span className="salem-holder" />
      </div>
      <div className="pointer-events-none absolute inset-[34%] flex flex-col items-center justify-center text-center">
        <span className="salem-center-icon" aria-hidden>
          {phase === "night" || phase === "confess"
            ? "☾"
            : phase === "conspiracy"
              ? "↻"
              : phase === "over"
                ? "⚖"
                : "🕯"}
        </span>
        {state && <span className="salem-deck-count">{state.deck_left}</span>}
      </div>
      {slots.map((slot, i) => {
        const pos = polarOval(i, n, n > 8 ? 44 : 42, n > 8 ? 38 : 34);
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
              {!alive && <span className="salem-dead-mark">✝</span>}
              {catHere && <img className="salem-cat-badge" src="/salem/icons/cat.svg" alt="" />}
              {p ? (p.user.username.slice(0, 1) || "?").toUpperCase() : "·"}
            </span>
            <span className="salem-name" title={p?.user.username}>
              {p ? p.user.username : emptyLabel}
            </span>
            {isSelf && p && <em className="salem-you">{youMarker}</em>}
            {!alive && p && <em className="salem-dead-label">— {deadLabel}</em>}
            {hall && <span className="salem-nameplate">{hall.name}</span>}
            {(pubTryals.revealed.length > 0 || pubTryals.facedown > 0) && (
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
              </div>
            )}
            {p && (
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
            className="absolute z-[1] -translate-x-1/2 -translate-y-1/2"
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
