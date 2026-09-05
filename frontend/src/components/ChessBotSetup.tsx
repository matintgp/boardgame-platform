"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";

export const BOT_PERSONAS = [
  "pawn",
  "knight",
  "bishop",
  "rook",
  "queen",
  "king",
] as const;

export type BotPersonaId = (typeof BOT_PERSONAS)[number];
export type PlayerColorPref = "white" | "black" | "random";

const COLORS: PlayerColorPref[] = ["white", "black", "random"];

function mapBotError(detail: string, t: (k: string) => string): string {
  const code = detail.trim().toLowerCase();
  if (code === "unknown_difficulty") return t("errorUnknownDifficulty");
  if (code === "invalid_player_color") return t("errorInvalidColor");
  if (code === "bot_capacity") return t("errorCapacity");
  if (code === "bot_engine_unavailable") return t("errorEngineUnavailable");
  if (code === "bot_engine_error") return t("errorEngine");
  return detail || t("startError");
}

export default function ChessBotSetup({
  open,
  onClose,
  initialPersona,
}: {
  open: boolean;
  onClose: () => void;
  initialPersona?: BotPersonaId;
}) {
  const t = useTranslations("chessBot");
  const router = useRouter();
  const titleId = useId();
  const subtitleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [persona, setPersona] = useState<BotPersonaId>(initialPersona ?? "knight");
  const [color, setColor] = useState<PlayerColorPref>("random");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPersona(initialPersona ?? "knight");
    setColor("random");
    setBusy(false);
    setError(null);
  }, [open, initialPersona]);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const root = dialogRef.current;
    const focusable = root?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!busy) onClose();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const nodes = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, busy, onClose]);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const g = await api<{ id: string }>("/api/games/bot", {
        method: "POST",
        body: JSON.stringify({
          difficulty: persona,
          player_color: color,
        }),
      });
      router.push(`/game/${g.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setError(mapBotError(msg, t));
      setBusy(false);
    }
  }, [persona, color, router, t]);

  if (!open) return null;

  return (
    <div
      className="chess-bot-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="chess-bot-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="chess-bot-dialog__head">
          <p className="kicker">{t("practice")}</p>
          <h2 id={titleId} className="type-h2">
            {t("setupTitle")}
          </h2>
          <p id={subtitleId} className="muted mt-1 text-sm">
            {t("setupSubtitle")}
          </p>
        </header>

        <div
          className="chess-bot-personas"
          role="radiogroup"
          aria-label={t("setupTitle")}
          aria-describedby={subtitleId}
        >
          {BOT_PERSONAS.map((id) => {
            const selected = persona === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`chess-bot-persona ${selected ? "is-selected" : ""}`}
                onClick={() => setPersona(id)}
                disabled={busy}
              >
                <img
                  src={`/chess/bots/${id}.svg`}
                  alt=""
                  width={64}
                  height={64}
                  className="chess-bot-persona__avatar"
                  draggable={false}
                />
                <span className="chess-bot-persona__name">
                  {t(`persona.${id}.name`)}
                </span>
                <span className="chess-bot-persona__flavor muted">
                  {t(`persona.${id}.flavor`)}
                </span>
                <span className="chess-bot-persona__pips" aria-hidden="true">
                  {Array.from({ length: 6 }, (_, i) => (
                    <i key={i} className={i < BOT_PERSONAS.indexOf(id) + 1 ? "on" : ""} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <p className="muted mt-2 text-center text-xs">{t("hierarchyHint")}</p>

        <div
          className="chess-bot-colors"
          role="radiogroup"
          aria-label={t("colorLabel")}
        >
          {COLORS.map((c) => {
            const selected = color === c;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`chess-bot-color ${selected ? "is-selected" : ""}`}
                onClick={() => setColor(c)}
                disabled={busy}
              >
                {c === "white"
                  ? t("colorWhite")
                  : c === "black"
                    ? t("colorBlack")
                    : t("colorRandom")}
              </button>
            );
          })}
        </div>

        {error && (
          <p className="chess-bot-error" role="alert">
            {error}
          </p>
        )}

        {busy && (
          <p className="muted mt-2 text-center text-sm" aria-live="polite">
            {t("preparing")}
          </p>
        )}

        <div className="chess-bot-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={busy}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void start()}
            disabled={busy || !persona}
          >
            {busy ? t("starting") : t("start")}
          </button>
        </div>
      </div>
    </div>
  );
}
