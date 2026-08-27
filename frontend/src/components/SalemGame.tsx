"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ensureSession, type SessionUser } from "@/lib/api";
import { Link, useRouter } from "@/i18n/navigation";
import { GameSocket, type Envelope } from "@/lib/gameSocket";
import ChatPanel from "@/components/ChatPanel";
import VoicePanel from "@/components/VoicePanel";
import SalemTable from "@/components/salem/SalemTable";
import SalemCard, { SalemTryalCard } from "@/components/salem/SalemCard";
import {
  accusationValue,
  cardFromId,
  cardI18nKey,
  cardNeedsTargets,
  RED_CARDS,
} from "@/components/salem/catalog";
import {
  playSalemCard,
  playSalemGavel,
  playSalemNight,
  playSalemReveal,
} from "@/components/salem/salemSounds";
import {
  ACCUSATION_THRESHOLD,
  SALEM_MAX_FALLBACK,
  SALEM_MIN_PLAYERS,
  adaptEngineState,
  extractState,
  isSeatAlive,
  leftSeat,
  marksOf,
  nameOf,
  publicTryalsOf,
  unrevealedTryalIndexes,
  type GameView,
  type PlayerInfo,
  type SalemCard as Card,
  type SalemPhase,
  type SalemState,
} from "@/components/salem/types";
import "@/styles/salem.css";

type Conn = "connecting" | "open" | "closed";

function deadlineMs(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v < 1e12 ? v * 1000 : v;
}

function handIds(you: SalemState["you"]): string[] {
  if (!you?.hand) return [];
  return you.hand.map((c) => (typeof c === "string" ? c : c.id));
}

export default function SalemGame({ gameId }: { gameId: string }) {
  const t = useTranslations("salem");
  const router = useRouter();
  const tv = useTranslations("voice");
  const tg = useTranslations("game");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [view, setView] = useState<GameView | null>(null);
  const [state, setState] = useState<SalemState | null>(null);
  const [conn, setConn] = useState<Conn>("connecting");
  const [wasOpen, setWasOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [socket, setSocket] = useState<GameSocket | null>(null);
  const [resultDismissed, setResultDismissed] = useState(false);
  const [rematchOffer, setRematchOffer] = useState<{ game_id: string; by: string } | null>(null);
  const [rematchBusy, setRematchBusy] = useState(false);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [pickedTargets, setPickedTargets] = useState<number[]>([]);
  const [fromSeat, setFromSeat] = useState<number | null>(null);
  const [tryalPrompt, setTryalPrompt] = useState<{
    card: Card;
    target?: number;
    from_seat?: number;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const socketRef = useRef<GameSocket | null>(null);
  const prevStateRef = useRef<SalemState | null>(null);
  const hydratedRef = useRef(false);
  const seatFetchRef = useRef(false);
  const tickedRef = useRef(false);
  const room = `game:${gameId}`;

  const applyEnvelope = useCallback(
    (env: Envelope) => {
      if (env.room && env.room !== room) return;
      if (env.type === "error") {
        const msg = (env.payload as { message?: string } | undefined)?.message;
        setError(msg ?? "error");
        return;
      }
      if (env.type === "rematch") {
        setRematchOffer(env.payload as { game_id: string; by: string });
        return;
      }
      if (env.type === "lobby_update") {
        const p = env.payload as Partial<GameView>;
        setView((prev) => {
          const merged = prev ? { ...prev, ...p } : ({ id: gameId, ...p } as GameView);
          if (merged.your_seat == null && !seatFetchRef.current) {
            seatFetchRef.current = true;
            api<GameView>(`/api/games/${gameId}`)
              .then((g) => {
                setView(g);
                if (g.state) setState(adaptEngineState(g.state, g.players ?? []));
              })
              .catch(() => undefined)
              .finally(() => {
                seatFetchRef.current = false;
              });
          }
          return merged;
        });
      } else if (env.type === "started" || env.type === "state") {
        setError(null);
        const payload = env.payload as {
          players?: PlayerInfo[];
          state?: SalemState;
          status?: string;
          events?: { type?: string }[];
        };
        setView((prev) => {
          const next = prev
            ? { ...prev }
            : ({
                id: gameId,
                game_type: "salem",
                status: "active",
                players: [],
                your_seat: null,
              } as GameView);
          if (payload.players) next.players = payload.players;
          if (payload.status) next.status = payload.status;
          if (env.type === "started") next.status = "active";
          return next;
        });
        const extracted = extractState(payload) ?? extractState(env.payload);
        if (extracted) {
          const roster = payload.players ?? view?.players ?? [];
          const nextState = adaptEngineState(extracted, roster);
          const prev = prevStateRef.current;
          prevStateRef.current = nextState;
          if (hydratedRef.current && prev) {
            if (nextState.phase !== prev.phase) {
              if (nextState.phase === "night") playSalemNight();
              else if (nextState.phase === "confess") playSalemReveal();
              else if (nextState.phase === "over") playSalemGavel();
              else playSalemCard();
            }
            const kinds = (payload.events ?? []).map((e) => e.type ?? "");
            if (kinds.some((k) => /card_played|play_card|draw/.test(k))) playSalemCard();
            if (kinds.some((k) => /tryal_revealed|confess/.test(k))) playSalemReveal();
            if (kinds.some((k) => /gavel/.test(k))) playSalemGavel();
          }
          hydratedRef.current = true;
          setState(nextState);
          setSelectedCard(null);
          setPickedTargets([]);
          setFromSeat(null);
          setTryalPrompt(null);
        }
      }
    },
    [room, gameId, view?.players]
  );

  useEffect(() => {
    let disposed = false;
    ensureSession().then(async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }
      if (disposed) return;
      setUser(u);
      try {
        const g = await api<GameView>(`/api/games/${gameId}`);
        setView(g);
        if (g.state) {
          const adapted = adaptEngineState(g.state, g.players ?? []);
          prevStateRef.current = adapted;
          hydratedRef.current = true;
          setState(adapted);
        }
      } catch {
        setError("game not found");
        return;
      }
      const s = new GameSocket();
      socketRef.current = s;
      setSocket(s);
      s.onMessage(applyEnvelope);
      s.onStatus((status) => {
        if (status === "open") setWasOpen(true);
        setConn(status);
      });
      s.connect();
      s.join(room);
    });
    return () => {
      disposed = true;
      socketRef.current?.close();
    };
  }, [applyEnvelope, gameId, room, router]);

  const confessUntil = deadlineMs(state?.confess_deadline ?? state?.deadline);
  useEffect(() => {
    if (!confessUntil) {
      tickedRef.current = false;
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [confessUntil]);

  useEffect(() => {
    if (state?.phase !== "confess" || !confessUntil) return;
    if (now < confessUntil || tickedRef.current) return;
    tickedRef.current = true;
    socketRef.current?.send({ type: "action", room, action: "tick", payload: {} });
  }, [now, confessUntil, state?.phase, room]);

  function sendAction(action: string, payload: Record<string, unknown> = {}) {
    setError(null);
    socketRef.current?.send({ type: "action", room, action, payload });
  }

  async function joinTable() {
    setError(null);
    try {
      await api(`/api/games/${gameId}/join`, { method: "POST" });
      const g = await api<GameView>(`/api/games/${gameId}`);
      setView(g);
      if (g.state) setState(adaptEngineState(g.state, g.players ?? []));
      socketRef.current?.join(room);
    } catch (e) {
      setError(e instanceof Error ? e.message : "join failed");
    }
  }

  async function start() {
    setError(null);
    try {
      await api(`/api/games/${gameId}/start`, { method: "POST" });
      setView((prev) => (prev ? { ...prev, status: "active" } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    }
  }

  async function rematch() {
    setError(null);
    setRematchBusy(true);
    try {
      const res = await api<{ game_id: string }>(`/api/games/${gameId}/rematch`, {
        method: "POST",
      });
      router.push(`/game/${res.game_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "rematch failed");
    } finally {
      setRematchBusy(false);
    }
  }

  const players = view?.players ?? [];
  const tableState = state;
  const you = tableState?.you ?? null;
  const status = view?.status ?? "waiting";
  const waiting = status === "waiting" && !tableState;
  const maxPlayers = view?.max_players ?? SALEM_MAX_FALLBACK;
  const minPlayers = view?.min_players ?? SALEM_MIN_PLAYERS;
  const mySeat = view?.your_seat ?? null;
  const isHost = view?.is_host ?? false;
  const canStart = isHost && waiting && players.length >= minPlayers;
  const phase: SalemPhase | null = tableState?.phase ?? null;
  const youAlive = you ? (you.alive ?? isSeatAlive(tableState, you.seat)) : false;
  const nSeats = Math.max(players.length, 1);

  const connLabel =
    conn === "open" ? tg("connected") : wasOpen ? tg("reconnecting") : tg("connecting");

  const teammates = you?.is_witch ? (you.teammates ?? []) : [];

  const orderedSeats = useMemo(() => {
    const seated = [...players].sort((a, b) => a.seat - b.seat);
    if (waiting) {
      const bySeat = new Map(seated.map((p) => [p.seat, p]));
      const slots: { seat: number; player: PlayerInfo | null }[] = [];
      for (let i = 0; i < maxPlayers; i++) {
        slots.push({ seat: i, player: bySeat.get(i) ?? null });
      }
      if (mySeat != null) {
        const idx = slots.findIndex((s) => s.seat === mySeat);
        if (idx > 0) return [...slots.slice(idx), ...slots.slice(0, idx)];
      }
      return slots;
    }
    if (mySeat != null) {
      const idx = seated.findIndex((p) => p.seat === mySeat);
      if (idx > 0) {
        const rotated = [...seated.slice(idx), ...seated.slice(0, idx)];
        return rotated.map((p) => ({ seat: p.seat, player: p }));
      }
    }
    return seated.map((p) => ({ seat: p.seat, player: p }));
  }, [players, waiting, maxPlayers, mySeat]);

  const myPick =
    pickedTargets[0] ??
    (phase === "night"
      ? (you?.my_night_kill ?? you?.my_gavel ?? you?.my_kill ?? you?.my_protect ?? null)
      : null);

  const needs = selectedCard ? cardNeedsTargets(selectedCard) : 0;
  const pickingFrom = selectedCard?.id === "scapegoat" && fromSeat == null;

  function canTargetSeat(seat: number) {
    if (conn !== "open") return false;
    if (!you || !youAlive) return false;
    if (!phase || phase === "over") return false;
    if (!isSeatAlive(tableState, seat)) return false;
    if (tryalPrompt) return false;
    if (selectedCard && (phase === "day" || phase === "turn") && you.can_play) {
      if (pickingFrom) return true;
      if (pickedTargets.includes(seat)) return false;
      return pickedTargets.length < needs;
    }
    if (phase === "night") {
      if (you.is_witch) return seat !== you.seat && !teammates.includes(seat);
      if (you.is_constable) return true;
      return false;
    }
    return false;
  }

  function actionLabel(): string {
    if (selectedCard) return pickingFrom ? t("pickFromSeat") : t("playOn");
    if (phase === "night" && you?.is_witch) return t("kill");
    if (phase === "night" && you?.is_constable) return t("gavel");
    return "";
  }

  function finishPlay(card: Card, target?: number, extra: Record<string, unknown> = {}) {
    const payload: Record<string, unknown> = { card_id: card.id };
    if (target != null) payload.target = target;
    if (Object.keys(extra).length) payload.extra = extra;
    playSalemCard();
    sendAction("play_card", payload);
    setSelectedCard(null);
    setPickedTargets([]);
    setFromSeat(null);
    setTryalPrompt(null);
  }

  function maybeTryalThenPlay(card: Card, target?: number, from?: number) {
    const extra: Record<string, unknown> = {};
    if (from != null) extra.from_seat = from;
    const marksNow = target != null ? marksOf(tableState, target) : 0;
    const wouldReveal =
      RED_CARDS.has(card.id) &&
      target != null &&
      marksNow + accusationValue(card) >= ACCUSATION_THRESHOLD;
    if (wouldReveal || (card.id === "scapegoat" && target != null)) {
      const open = unrevealedTryalIndexes(
        tableState?.players.find((p) => p.seat === target)
      );
      if (wouldReveal && open.length) {
        setTryalPrompt({ card, target, from_seat: from });
        return;
      }
    }
    finishPlay(card, target, extra);
  }

  function onSeatActivate(seat: number) {
    if (!canTargetSeat(seat)) return;
    if (selectedCard && (phase === "day" || phase === "turn")) {
      if (selectedCard.id === "scapegoat" && fromSeat == null) {
        setFromSeat(seat);
        return;
      }
      const next = [...pickedTargets, seat];
      if (next.length < needs) {
        setPickedTargets(next);
        return;
      }
      maybeTryalThenPlay(selectedCard, next[0], fromSeat ?? undefined);
      return;
    }
    if (phase === "night" && you?.is_witch) {
      playSalemNight();
      sendAction("night_kill", { target: seat });
      return;
    }
    if (phase === "night" && you?.is_constable) {
      playSalemGavel();
      sendAction("gavel", { target: seat });
    }
  }

  function onCardClick(card: Card) {
    if (!you?.can_play || (phase !== "day" && phase !== "turn") || !youAlive) return;
    if (selectedCard?.id === card.id) {
      setSelectedCard(null);
      setPickedTargets([]);
      setFromSeat(null);
      return;
    }
    const nNeed = cardNeedsTargets(card);
    if (nNeed === 0) {
      finishPlay(card);
      return;
    }
    setSelectedCard(card);
    setPickedTargets([]);
    setFromSeat(null);
  }

  function confess(index: number) {
    playSalemReveal();
    sendAction("confess", { tryal_index: index });
  }

  async function reportPlayer(p: PlayerInfo) {
    const reason = window.prompt(t("reportPrompt"));
    if (!reason) return;
    try {
      await api("/api/reports", {
        method: "POST",
        body: JSON.stringify({
          reported_user_id: p.user.id,
          reason,
          game_id: gameId,
        }),
      });
    } catch {
      /* silent */
    }
  }

  function cardCopy(id: string): Card {
    const k = cardI18nKey(id) ?? id;
    try {
      return cardFromId(id, t(`cards.${k}.title`), t(`cards.${k}.text`));
    } catch {
      return cardFromId(id);
    }
  }

  const iMustConfess = !!you && youAlive && phase === "confess";
  const showConfessOverlay = iMustConfess && !tryalPrompt;
  const showConspiracy =
    phase === "conspiracy" && !!you && youAlive && you.my_conspiracy_pick == null;

  const phaseTitle =
    phase === "day" || phase === "turn"
      ? t("phaseDay")
      : phase === "conspiracy"
        ? t("phaseConspiracy")
        : phase === "night"
          ? t("phaseNight")
          : phase === "confess"
            ? t("phaseConfess")
            : phase === "over"
              ? t("gameOver")
              : t("phaseDawn");

  const phaseHint = !you
    ? t("spectatorHint")
    : !youAlive
      ? t("spectatorHint")
      : phase === "day" || phase === "turn"
        ? tableState?.current_seat === you.seat
          ? t("yourTurnHint")
          : t("waitingTurn", { name: nameOf(players, tableState?.current_seat ?? -1) })
        : phase === "conspiracy"
          ? you.my_conspiracy_pick != null
            ? t("waitingConspiracy")
            : t("conspiracyHint", {
                name: nameOf(players, leftSeat(you.seat, nSeats)),
              })
          : phase === "night"
            ? you.is_witch
              ? you.my_night_kill != null
                ? t("waitingWitches")
                : t("nightHintWitch")
              : you.is_constable
                ? you.my_gavel != null
                  ? t("waitingNight")
                  : t("nightHintConstable")
                : t("nightHintTown")
            : phase === "confess"
              ? t("confessHint")
              : "";

  const winnerRole = tableState?.result?.winner ?? tableState?.result?.winner_role ?? "town";
  const witchesWin = winnerRole === "witches" || winnerRole === "witches_won";
  const iWon =
    tableState?.result != null &&
    you != null &&
    tableState.result.winner_seats.includes(you.seat);
  const everWitch =
    tableState?.result?.ever_witch ??
    (tableState?.result?.roles
      ? Object.entries(tableState.result.roles)
          .filter(([, r]) => r === "witch" || r === "witches")
          .map(([s]) => Number(s))
      : []);

  const secondsLeft =
    confessUntil != null ? Math.max(0, Math.ceil((confessUntil - now) / 1000)) : null;
  const remainingTryals = you?.tryals?.filter((tr) => !tr.revealed) ?? [];
  const left = you ? leftSeat(you.seat, nSeats) : 0;
  const leftPub = tableState ? publicTryalsOf(tableState, left) : { total: 0, revealed: [] };
  const leftOpen = unrevealedTryalIndexes(tableState?.players.find((p) => p.seat === left));

  const ids = handIds(you);

  return (
    <div className="salem-root grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="mx-auto w-full max-w-2xl">
        {rematchOffer && (
          <div className="card mb-4 flex items-center justify-between gap-3 border-[var(--accent)] p-4">
            <span>
              🔁 <span className="font-bold">{rematchOffer.by}</span> {tg("rematchOffer")}
            </span>
            <button className="btn btn-primary" onClick={() => router.push(`/game/${rematchOffer.game_id}`)}>
              {tg("accept")}
            </button>
          </div>
        )}

        <p className="muted mb-2 text-center text-xs" aria-live="polite">
          {conn === "open" ? (
            <span className="text-emerald-400/80">● {connLabel}</span>
          ) : (
            <span>◌ {connLabel}</span>
          )}
        </p>

        {waiting ? (
          <div className="salem-lobby card overflow-hidden">
            <div className="salem-lobby-hero">
              <img src="/salem/hero.jpg" alt="" />
              <div className="salem-lobby-shade" />
              <div className="relative z-[1] p-5">
                <h2 className="text-2xl font-bold">🕯 {t("title")}</h2>
                <p className="muted mt-1 text-sm">{t("tagline")}</p>
              </div>
            </div>
            <div className="p-5">
              <p className="muted mb-1 text-sm">
                ⏳ {t("waitingForPlayers")} ({players.length}/{maxPlayers})
              </p>
              <p className="muted mb-4 text-xs">
                {players.length < minPlayers
                  ? t("needMinPlayers", { count: minPlayers })
                  : isHost
                    ? t("hostCanStart")
                    : t("waitingForHost")}
              </p>
              <SalemTable
                slots={orderedSeats}
                state={null}
                phase={null}
                youSeat={mySeat}
                userId={user?.id}
                selected={null}
                targetable={() => false}
                actionLabel=""
                youMarker={t("youMarker")}
                emptyLabel={t("emptySeat")}
                deadLabel={t("dead")}
                accusationsLabel={t("accusations")}
                onActivate={() => undefined}
                onReport={reportPlayer}
                showWitchMarks={false}
                teammates={[]}
              />
              {view && mySeat == null && (
                <button className="btn btn-primary mt-4 w-full" onClick={joinTable}>
                  {tg("join")}
                </button>
              )}
              {canStart && (
                <button className="btn btn-primary mt-4 w-full" onClick={start}>
                  ▶ {tg("start")}
                </button>
              )}
              {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            </div>
          </div>
        ) : !tableState ? (
          <div className="card p-6 text-center">
            <p className="muted">{tg("connecting")}</p>
          </div>
        ) : (
          <>
            <div
              key={tableState.phase}
              className={`salem-phase-banner mb-4 ${
                tableState.phase === "night" || tableState.phase === "confess"
                  ? "is-night"
                  : tableState.phase === "conspiracy"
                    ? "is-dawn"
                    : tableState.phase === "over"
                      ? "is-over"
                      : "is-turn"
              }`}
            >
              <p className="salem-phase-title">
                {tableState.phase === "night"
                  ? `☾ ${phaseTitle}`
                  : tableState.phase === "confess"
                    ? `⚖ ${phaseTitle}`
                    : tableState.phase === "over"
                      ? `🏁 ${phaseTitle}`
                      : tableState.phase === "conspiracy"
                        ? `✦ ${phaseTitle}`
                        : `🕯 ${phaseTitle}`}
              </p>
              <p className="muted mt-0.5 text-sm">
                {t("round")} {tableState.round}
                {tableState.phase === "day" && tableState.current_seat != null && (
                  <>
                    {" · "}
                    {t("seatTurn", { name: nameOf(players, tableState.current_seat) })}
                  </>
                )}
              </p>
            </div>

            {you && (
              <div
                className={`salem-role-card card mb-4 p-4 ${
                  you.is_witch ? "is-witch" : !youAlive ? "is-dead" : ""
                }`}
              >
                <p className="muted text-xs uppercase tracking-wide">{t("yourAllegiance")}</p>
                <p className={`mt-1 text-xl font-extrabold ${you.is_witch ? "text-red-400" : "text-[var(--accent)]"}`}>
                  {you.is_witch ? t("roleWitch") : t("roleTown")}
                  {you.is_constable ? ` · ${t("roleConstable")}` : ""}
                </p>
                {you.is_witch && (
                  <p className="muted mt-1 text-xs">
                    🤝 {t("teammates")}:{" "}
                    {teammates.filter((s) => s !== you.seat).map((s) => nameOf(players, s)).join(", ") || "—"}
                  </p>
                )}
                {!youAlive && <p className="mt-2 text-sm text-zinc-300">✝ {t("spectatorBanner")}</p>}
                {youAlive && phase !== "over" && <p className="muted mt-2 text-xs">{phaseHint}</p>}
                {(you.tryals ?? []).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(you.tryals ?? []).map((tr) => (
                      <span
                        key={tr.index}
                        className={`salem-own-tryal ${tr.revealed ? `is-${tr.kind}` : "is-hidden"}`}
                      >
                        {tr.revealed
                          ? tr.kind === "witch"
                            ? t("tryalWitch")
                            : tr.kind === "constable"
                              ? t("tryalConstable")
                              : t("tryalTown")
                          : t("tryalHidden")}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!you && tableState.phase !== "over" && (
              <div className="card mb-4 border-zinc-700 bg-[#12141a] p-4">
                <p className="text-sm">👁 {t("spectatorBanner")}</p>
                <p className="muted mt-1 text-xs">{t("spectatorHint")}</p>
              </div>
            )}

            {tableState.last_night && (
              <div className="card mb-4 p-4 text-sm">
                ☾ {t("nightResult")}{" "}
                {tableState.last_night.killed != null ? (
                  <span className="text-red-400">
                    {t("someoneDied", { name: nameOf(players, tableState.last_night.killed) })}
                  </span>
                ) : (
                  <span className="text-emerald-400">{t("nobodyDied")}</span>
                )}
              </div>
            )}

            <SalemTable
              slots={orderedSeats}
              state={tableState}
              phase={tableState.phase}
              youSeat={you?.seat ?? mySeat}
              userId={user?.id}
              selected={myPick}
              targetable={canTargetSeat}
              actionLabel={youAlive ? actionLabel() : ""}
              youMarker={t("youMarker")}
              emptyLabel={t("emptySeat")}
              deadLabel={t("dead")}
              accusationsLabel={t("accusations")}
              onActivate={onSeatActivate}
              onReport={reportPlayer}
              showWitchMarks={!!you?.is_witch}
              teammates={teammates}
            />

            {you && youAlive && (phase === "day" || phase === "turn") && (
              <div className="salem-hand mt-5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="font-semibold">{t("handTitle")}</h3>
                  {selectedCard && (
                    <button
                      className="btn btn-ghost !py-1 !px-2 text-xs"
                      onClick={() => {
                        setSelectedCard(null);
                        setPickedTargets([]);
                        setFromSeat(null);
                      }}
                    >
                      {t("cancelCard")}
                    </button>
                  )}
                </div>
                <p className="muted mb-3 text-xs">
                  {selectedCard
                    ? pickingFrom
                      ? t("pickFromSeat")
                      : t("pickTarget")
                    : t("playHint")}
                </p>
                <div className="salem-hand-row">
                  {ids.length === 0 && <p className="muted text-sm">{t("emptyHand")}</p>}
                  {ids.map((id, i) => {
                    const card = cardCopy(id);
                    return (
                      <SalemCard
                        key={`${id}-${i}`}
                        card={card}
                        title={card.title}
                        text={card.text}
                        selected={selectedCard?.id === id}
                        disabled={!you.can_play || conn !== "open"}
                        onClick={() => onCardClick(card)}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          </>
        )}
      </div>

      <div className="flex w-full min-w-0 flex-col gap-4 self-start">
        <VoicePanel
          gameId={gameId}
          selfName={user?.username}
          defaultCollapsed
          labels={{
            join: tv("join"),
            leave: tv("leave"),
            mute: tv("mute"),
            unmute: tv("unmute"),
            title: tv("title"),
            micError: tv("micError"),
          }}
        />
        <ChatPanel
          socket={socket}
          selfName={user?.username}
          room={room}
          title={t("chatTitle")}
          placeholder={t("chatPlaceholder")}
          sendLabel={t("chatSend")}
          defaultCollapsed
        />
        {tableState && tableState.log.length > 0 && (
          <div className="card max-h-64 overflow-auto p-4">
            <h3 className="mb-2 font-semibold">{t("logTitle")}</h3>
            <ol className="flex flex-col gap-2 text-xs">
              {tableState.log.map((entry, i) => (
                <LogLine key={i} entry={entry} players={players} t={t} />
              ))}
            </ol>
          </div>
        )}
        {tableState && <p className="muted px-1 text-[11px]">{t("rulesBlurb")}</p>}
      </div>

      {tryalPrompt && (
        <div className="salem-overlay">
          <div className="result-pop salem-parchment-card relative w-full max-w-sm p-6 text-center">
            <h2 className="text-xl font-extrabold">{t("pickTryalTitle")}</h2>
            <p className="muted mt-2 text-sm">
              {tryalPrompt.target != null
                ? t("pickTryalHint", { name: nameOf(players, tryalPrompt.target) })
                : t("pickOwnTryal")}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {unrevealedTryalIndexes(
                tableState?.players.find((p) => p.seat === tryalPrompt.target)
              ).map((idx) => (
                <button
                  key={idx}
                  className="btn btn-primary"
                  onClick={() =>
                    finishPlay(tryalPrompt.card, tryalPrompt.target, {
                      tryal_index: idx,
                      ...(tryalPrompt.from_seat != null ? { from_seat: tryalPrompt.from_seat } : {}),
                    })
                  }
                >
                  {t("tryalN", { n: idx + 1 })}
                </button>
              ))}
            </div>
            <button
              className="btn btn-ghost mt-4"
              onClick={() => {
                setTryalPrompt(null);
                setSelectedCard(null);
                setPickedTargets([]);
                setFromSeat(null);
              }}
            >
              {t("cancelCard")}
            </button>
          </div>
        </div>
      )}

      {showConspiracy && (
        <div className="salem-overlay">
          <div className="result-pop salem-parchment-card relative w-full max-w-sm p-6 text-center">
            <h2 className="text-xl font-extrabold">{t("phaseConspiracy")}</h2>
            <p className="muted mt-2 text-sm">
              {t("conspiracyHint", { name: nameOf(players, left) })}
            </p>
            <p className="muted mt-1 text-xs">
              {leftPub.revealed.length}/{leftPub.total}
            </p>
            <div className="salem-tryal-pick mt-4">
              {leftOpen.map((idx) => (
                <SalemTryalCard
                  key={idx}
                  index={idx}
                  label={t("tryalN", { n: idx + 1 })}
                  onClick={() => sendAction("conspiracy_take", { tryal_index: idx })}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {showConfessOverlay && (
        <div className="salem-overlay">
          <div className="result-pop salem-parchment-card relative w-full max-w-sm p-6 text-center">
            <h2 className="text-xl font-extrabold">⚖ {t("confessTitle")}</h2>
            <p className="muted mt-2 text-sm">{t("confessHint")}</p>
            {secondsLeft != null && (
              <p className="salem-countdown mt-3" aria-live="polite">
                {t("confessCountdown", { seconds: secondsLeft })}
              </p>
            )}
            <div className="mt-4 flex flex-col gap-2">
              {remainingTryals.length === 0 && (
                <p className="muted text-sm">{t("noTryalsLeft")}</p>
              )}
              {remainingTryals.map((tr) => (
                <button
                  key={tr.index}
                  className="btn btn-primary"
                  onClick={() => confess(tr.index)}
                >
                  {t("confessReveal", {
                    n: tr.index + 1,
                    kind:
                      tr.kind === "witch"
                        ? t("tryalWitch")
                        : tr.kind === "constable"
                          ? t("tryalConstable")
                          : t("tryalTown"),
                  })}
                </button>
              ))}
            </div>
            <button className="btn btn-ghost mt-4" onClick={() => sendAction("confess_skip")}>
              {t("confessSkip")}
            </button>
          </div>
        </div>
      )}

      {tableState?.result && !resultDismissed && (
        <div className="salem-overlay">
          <div className="result-pop salem-parchment-card relative w-full max-w-sm p-6 text-center">
            <div
              className={`mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-4xl ${
                iWon ? "trophy-glow" : ""
              }`}
            >
              {witchesWin ? "☾" : "☀"}
            </div>
            <h2 className="text-2xl font-extrabold text-[var(--accent)]">
              {witchesWin ? t("witchesWon") : t("townWon")}
            </h2>
            <p className="muted mt-1 text-xs">{t("winnerTeam")}</p>
            {you && (
              <p className="mt-2 text-sm font-semibold">{iWon ? t("youWon") : t("youLost")}</p>
            )}
            <p className="muted mt-2 text-sm">
              {tableState.result.winner_seats.map((s) => nameOf(players, s)).join(", ")}
            </p>
            {everWitch.length > 0 && (
              <ul className="mt-4 space-y-1 text-start text-sm">
                <li className="muted text-xs uppercase tracking-wide">{t("everWitch")}</li>
                {everWitch.map((s) => (
                  <li key={s} className="flex justify-between gap-2">
                    <span>
                      {nameOf(players, s)}
                      {s === you?.seat && <em className="muted ms-1">{t("youMarker")}</em>}
                    </span>
                    <span className="text-red-400">{t("roleWitch")}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <button className="btn btn-primary" onClick={rematch} disabled={rematchBusy}>
                🔁 {tg("rematch")}
              </button>
              <Link href="/lobby" className="btn btn-ghost">
                {tg("backToLobby")}
              </Link>
              <button className="btn btn-ghost" onClick={() => setResultDismissed(true)}>
                {tg("reviewBoard")}
              </button>
            </div>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function LogLine({
  entry,
  players,
  t,
}: {
  entry: Record<string, unknown>;
  players: PlayerInfo[];
  t: ReturnType<typeof useTranslations>;
}) {
  const round = Number(entry.round ?? 0);
  const kind = String(entry.type ?? entry.kind ?? entry.action ?? entry.phase ?? "");
  const seat = entry.seat != null ? Number(entry.seat) : null;
  const target = entry.target != null ? Number(entry.target) : null;
  const killed = entry.killed;
  const msg = typeof entry.message === "string" ? entry.message : null;
  const who = seat != null && Number.isFinite(seat) ? nameOf(players, seat) : "";
  const whom = target != null && Number.isFinite(target) ? nameOf(players, target) : "";
  let body = msg;
  if (!body) {
    if (kind === "night" || kind === "night_resolved") {
      body =
        killed == null
          ? t("nobodyDied")
          : t("someoneDied", { name: nameOf(players, Number(killed)) });
    } else if (kind === "card_played" || kind === "play_card") {
      body = t("logPlay", {
        name: who,
        card: String(entry.card ?? entry.card_id ?? ""),
        target: whom,
      });
    } else if (kind === "tryal_revealed") {
      body = t("logReveal", { name: who || whom });
    } else if (kind === "confess") {
      body = t("logConfess", { name: who });
    } else if (kind === "gavel") {
      body = t("logGavel", { name: who });
    } else if (kind === "conspiracy_take" || kind === "conspiracy_resolved") {
      body = t("logConspiracy");
    } else if (kind === "over" || kind === "game_over") {
      body = t("gameOver");
    } else {
      body = kind || JSON.stringify(entry);
    }
  }
  return (
    <li>
      <span className="muted">
        {t("round")} {round}
        {kind ? ` · ${kind}` : ""}
      </span>
      <div>{body}</div>
    </li>
  );
}
