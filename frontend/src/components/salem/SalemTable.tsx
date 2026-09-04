"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  cardI18nKey,
  hallPortrait,
  playCardInfo,
  tryalKindFromId,
  townHallI18nKey,
} from "./catalog";
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
  reportLabel,
  deckLabel = "Deck",
  discardLabel = "Discard",
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
  reportLabel: string;
  deckLabel?: string;
  discardLabel?: string;
  onActivate: (seat: number) => void;
  onReport: (p: PlayerInfo) => void;
  showWitchMarks: boolean;
  teammates: number[];
}) {
  const t = useTranslations("salem");
  const locale = useLocale();
  const fmt = (n: number) => n.toLocaleString(locale === "fa" ? "fa-IR" : "en-US");
  const n = slots.length;
  const crowded = n >= 10;
  const intimate = n > 0 && n <= 6;
  const tableClass =
    phase === "confess"
      ? "is-night is-confess"
      : phase === "night"
        ? "is-night"
        : phase === "dawn"
          ? "is-dawn"
          : phase === "conspiracy"
            ? "is-conspiracy"
            : phase === "town_hall"
              ? "is-town-hall is-day"
              : phase === "day"
                ? "is-day is-turn"
                : phase === "over"
                  ? "is-over"
                  : "";

  // Closest seat to the reveal threshold (visible state only).
  const perSeatMax = state
    ? Math.max(0, ...Object.values(state.marks ?? {}).map((v) => Number(v) || 0))
    : 0;
  const potLit = Math.min(MARK_THRESHOLD, perSeatMax);

  const [pop, setPop] = useState<{ seat: number; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!pop) return;
    const close = () => setPop(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [pop]);

  function openPop(e: MouseEvent<HTMLElement>, seat: number) {
    e.stopPropagation();
    if (pop?.seat === seat) {
      setPop(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const w = 232;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const estH = 180;
    let y = r.bottom + 10;
    if (y + estH > window.innerHeight - 8) y = Math.max(8, r.top - estH - 10);
    setPop({ seat, x, y });
  }

  function cardTitle(id: string): string {
    const k = cardI18nKey(id);
    if (k) {
      try {
        return t(`cards.${k}.title`);
      } catch {
        /* fall through */
      }
    }
    return playCardInfo(id).title;
  }

  function potSeals() {
    return (
      <div className="salem-pot-seals" aria-hidden>
        {Array.from({ length: MARK_THRESHOLD }).map((_, i) => (
          <span key={i} className={`salem-pot-seal ${i < potLit ? "" : "is-off"}`} />
        ))}
      </div>
    );
  }

  function renderChip(slot: Slot, mode: "table" | "strip") {
    const p = slot.player;
    const hall = townHallOf(state, slot.seat);
    const hallKey = hall ? townHallI18nKey(hall.id) : null;
    const hallName = hallKey ? t(`halls.${hallKey}`) : null;
    const isSelf = p ? p.user.id === userId || slot.seat === youSeat : slot.seat === youSeat;
    const alive = p ? isSeatAlive(state, slot.seat) : true;
    const picked = selected === slot.seat;
    const canHit = p != null && targetable(slot.seat);
    const mate = showWitchMarks && teammates.includes(slot.seat);
    const current = state?.current_seat === slot.seat && phase === "day";
    const blues = bluesOf(state, slot.seat);
    const catHere = blues.includes("black_cat");
    const pubTryals = tryalsOf(state, slot.seat);
    const acc = marksOf(state, slot.seat);
    const initial = p ? (p.user.username.slice(0, 1) || "?").toUpperCase() : "·";

    const avatar = (
      <span
        className={`salem-avatar ${picked ? "is-picked" : ""} ${mate ? "is-mate" : ""} ${
          !p ? "is-empty" : ""
        } ${canHit ? "is-target" : ""}`}
      >
        {hall && hallPortrait(hall.id) ? (
          <SeatPortrait hallId={hall.id} name={hallName ?? ""} />
        ) : (
          <span className="salem-portrait salem-portrait-fallback" aria-hidden>
            {initial}
          </span>
        )}
        {p && (acc > 0 || catHere) && (
          <span className="salem-badges" aria-hidden>
            {acc > 0 && <span className="salem-wbadge">{fmt(acc)}</span>}
            {catHere && <img className="salem-catb" src="/salem/icons/cat.svg" alt="" />}
          </span>
        )}
        {!alive && <span className="salem-dead-mark">✝</span>}
      </span>
    );

    if (mode === "strip") {
      return (
        <div className={`salem-opp ${!alive ? "is-dead" : ""} ${current ? "is-current" : ""}`}>
          {avatar}
          <span className="salem-opp-name">
            {p ? p.user.username : emptyLabel}
            {isSelf && p ? ` ${youMarker}` : ""}
          </span>
        </div>
      );
    }

    return (
      <div
        className={`salem-seat ${!alive ? "is-dead" : ""} ${current ? "is-current" : ""} ${
          isSelf && p ? "is-self" : ""
        }`}
      >
        {avatar}
        <span className="salem-name">
          {p ? p.user.username : emptyLabel}
          {isSelf && p && <em className="salem-you">{youMarker}</em>}
          {(hallName || (!alive && p)) && <small>{!alive && p ? deadLabel : hallName}</small>}
        </span>
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
        {blues.length > 0 && (
          <div className="salem-blues">
            {blues.map((id, bi) => (
              <span key={`${id}-${bi}`} className="salem-blue-chip" title={cardTitle(id)}>
                {cardTitle(id)}
              </span>
            ))}
          </div>
        )}
        {canHit && actionLabel && <span className="salem-action-hint">{actionLabel}</span>}
      </div>
    );
  }

  function renderClickable(slot: Slot, mode: "table" | "strip") {
    const p = slot.player;
    const hall = townHallOf(state, slot.seat);
    const canHit = p != null && targetable(slot.seat);
    const chip = renderChip(slot, mode);
    if (!canHit && !p && !hall) return chip;
    return (
      <button
        type="button"
        className="salem-seat-btn"
        aria-label={`${p?.user.username ?? slot.seat} ${canHit ? actionLabel : ""}`}
        onClick={(e) => (canHit ? onActivate(slot.seat) : openPop(e, slot.seat))}
      >
        {chip}
      </button>
    );
  }

  const popSlot = pop ? slots.find((s) => s.seat === pop.seat) : null;
  const popPlayer = popSlot?.player ?? null;
  const popHall = pop ? townHallOf(state, pop.seat) : null;
  const popKey = popHall ? townHallI18nKey(popHall.id) : null;

  return (
    <div className={`salem-stage ${tableClass}`}>
      <div
        className={`salem-table ${crowded ? "is-crowded" : intimate ? "is-intimate" : ""}`}
        dir="ltr"
      >
        <div className="salem-night-fog" aria-hidden />

        <div className="salem-zone salem-zone-deck">
          <span className="salem-zone-num">{state ? fmt(state.deck_left) : "—"}</span>
          <span className="salem-zone-label">{deckLabel}</span>
        </div>
        <div className="salem-zone salem-zone-discard">
          <span className="salem-zone-num">
            {state?.discard_top ? cardTitle(state.discard_top) : "—"}
          </span>
          <span className="salem-zone-label">{discardLabel}</span>
        </div>

        <div className="salem-pot">
          {potSeals()}
          <small>{t("sealsToTryal", { count: potLit, threshold: MARK_THRESHOLD })}</small>
        </div>

        {slots.map((slot, i) => {
          const pos = polarOval(i, n, crowded ? 41 : n > 8 ? 40 : 42, crowded ? 36 : n > 8 ? 35 : 37);
          return (
            <div
              key={slot.player ? `p-${slot.player.seat}` : `empty-${slot.seat}`}
              className="salem-seat-pos"
              style={pos}
            >
              {renderClickable(slot, "table")}
            </div>
          );
        })}
      </div>

      <div className="salem-mobile">
        <div className="salem-opps">
          {slots.map((slot) => (
            <div key={slot.player ? `mp-${slot.player.seat}` : `mempty-${slot.seat}`}>
              {renderClickable(slot, "strip")}
            </div>
          ))}
        </div>
        <div className="salem-potm">
          <span>{t("sealsUntilTryal")}</span>
          {potSeals()}
        </div>
        <div className="salem-mfelt">
          <div className="salem-mfelt-pile">
            <b>{state ? fmt(state.deck_left) : "—"}</b>
            {deckLabel}
          </div>
          <div className="salem-mfelt-pile">
            <b>{state?.discard_top ? cardTitle(state.discard_top) : "—"}</b>
            {discardLabel}
          </div>
        </div>
      </div>

      {pop && popSlot && (
        <div
          className="salem-pop"
          style={{ left: pop.x, top: pop.y }}
          role="dialog"
          onClick={(e) => e.stopPropagation()}
        >
          <b>{popPlayer ? popPlayer.user.username : emptyLabel}</b>
          {popKey ? (
            <>
              <small>
                {t(`halls.${popKey}`)} · {t(`hallRoles.${popKey}`)}
              </small>
              <span>{t(`hallAbilities.${popKey}`)}</span>
            </>
          ) : null}
          {popPlayer && popPlayer.user.id !== userId && (
            <button
              type="button"
              className="salem-btn salem-btn-ghost salem-pop-report"
              onClick={() => {
                setPop(null);
                onReport(popPlayer);
              }}
            >
              ⚑ {reportLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
