"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ensureSession, type SessionUser } from "@/lib/api";
import { parseExpiryMs, remainingLobby } from "@/lib/lobbyExpiry";
import { joinRematchTable } from "@/lib/rematch";
import { Link, useRouter } from "@/i18n/navigation";
import { GameSocket, type Envelope } from "@/lib/gameSocket";
import { playGameEndSound } from "@/lib/sounds";
import ChatPanel from "@/components/ChatPanel";
import VoicePanel from "@/components/VoicePanel";
import "@/styles/salem.css";
import SalemTable from "./SalemTable";
import {
  accusationValue,
  cardForbidsSelf,
  cardI18nKey,
  cardNeedsTarget,
  playCardInfo,
  hallPortrait,
  townHallI18nKey,
  tryalKindFromId,
} from "./catalog";
import {
  playSalemCard,
  playSalemGavel,
  playSalemNight,
  playSalemReveal,
} from "./salemSounds";
import {
  MARK_THRESHOLD,
  SALEM_MAX_FALLBACK,
  SALEM_MIN_PLAYERS,
  extractState,
  isSeatAlive,
  leftSeat,
  marksOf,
  nameOf,
  seatCount,
  unrevealedOwnIndexes,
  unrevealedPublicIndexes,
  tryalsOf,
  type GameView,
  type PlayerInfo,
  type SalemPhase,
  type SalemState,
} from "./types";

type Conn = "connecting" | "open" | "closed";
type NightTool = "kill" | "gavel";

function deadlineMs(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v < 1e12 ? v * 1000 : v;
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
  const [rematchOffer, setRematchOffer] = useState<{ game_id: string; by: string } | null>(
    null
  );
  const [rematchBusy, setRematchBusy] = useState(false);
  const [selectedHandIndex, setSelectedHandIndex] = useState<number | null>(null);
  const [nightTool, setNightTool] = useState<NightTool>("kill");
  const [confessedLocal, setConfessedLocal] = useState(false);
  const [tryalPrompt, setTryalPrompt] = useState<{
    cardId: string;
    target: number;
    extra: Record<string, unknown>;
  } | null>(null);
  const [scapegoatFrom, setScapegoatFrom] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const socketRef = useRef<GameSocket | null>(null);
  const prevStateRef = useRef<SalemState | null>(null);
  const hydratedRef = useRef(false);
  const seatFetchRef = useRef(false);
  const tickedRef = useRef<number | null>(null);
  const phaseRef = useRef<SalemPhase | null>(null);
  const seenRevealKeyRef = useRef<string | null>(null);
  const [revealedSlots, setRevealedSlots] = useState<Record<number, number[]>>({});
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
        const p = env.payload as { game_id: string; by: string };
        setRematchOffer(p);
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
                if (g.state) setState(extractState(g) ?? g.state);
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
        const nextState = extractState(payload) ?? extractState(env.payload);
        if (nextState) {
          const prev = prevStateRef.current;
          prevStateRef.current = nextState;
          if (hydratedRef.current && prev) {
            if (nextState.phase !== prev.phase) {
              if (nextState.phase === "night") playSalemNight();
              else if (nextState.phase === "confess") playSalemReveal();
              else if (nextState.phase === "conspiracy") playSalemCard();
              else playSalemCard();
            }
            if (nextState.phase === "over" && prev.phase !== "over") playGameEndSound();
            const prevRev = prev.last_reveal?.id;
            const nextRev = nextState.last_reveal?.id;
            if (nextState.last_reveal && nextRev && nextRev !== prevRev) playSalemReveal();
          }
          hydratedRef.current = true;
          setState(nextState);
          if (!prev || nextState.phase !== prev.phase || nextState.current_seat !== prev.current_seat) {
            setSelectedHandIndex(null);
            setTryalPrompt(null);
          }
          if (!prev || nextState.phase !== prev.phase) {
            setConfessedLocal(false);
            const you = nextState.you;
            setNightTool(you?.is_witch ? "kill" : "gavel");
          }
        }
      }
    },
    [room, gameId]
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
        const st = g.state ? extractState(g) ?? extractState(g.state) : null;
        if (st) {
          prevStateRef.current = st;
          hydratedRef.current = true;
          setState(st);
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

  useEffect(() => {
    setRevealedSlots({});
    seenRevealKeyRef.current = null;
    phaseRef.current = null;
  }, [gameId]);

  useEffect(() => {
    if (phaseRef.current === "conspiracy" && state?.phase === "day") {
      setRevealedSlots({});
    }
    phaseRef.current = state?.phase ?? null;
    const lr = state?.last_reveal;
    if (!lr || typeof lr.index !== "number") return;
    const key = `${lr.seat}:${lr.index}:${lr.id}`;
    if (seenRevealKeyRef.current === key) return;
    seenRevealKeyRef.current = key;
    setRevealedSlots((map) => {
      const cur = map[lr.seat] ?? [];
      if (cur.includes(lr.index)) return map;
      return { ...map, [lr.seat]: [...cur, lr.index] };
    });
  }, [state?.phase, state?.last_reveal?.seat, state?.last_reveal?.index, state?.last_reveal?.id]);

  const confessUntil = deadlineMs(state?.confess_deadline);
  useEffect(() => {
    if (state?.phase !== "confess" || !confessUntil) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [state?.phase, confessUntil]);

  function sendAction(action: string, payload: Record<string, unknown> = {}) {
    setError(null);
    socketRef.current?.send({ type: "action", room, action, payload });
  }

  function openPublicTryals(seat: number): number[] {
    return unrevealedPublicIndexes(tryalsOf(state, seat), revealedSlots[seat]);
  }

  useEffect(() => {
    if (state?.phase !== "confess") {
      tickedRef.current = null;
      return;
    }
    const until = deadlineMs(state.confess_deadline);
    if (until == null) return;
    const fire = () => {
      if (tickedRef.current === until) return;
      tickedRef.current = until;
      socketRef.current?.send({ type: "action", room, action: "tick", payload: {} });
    };
    const wait = until - Date.now();
    if (wait <= 0) {
      fire();
      return;
    }
    const id = window.setTimeout(fire, wait + 40);
    return () => window.clearTimeout(id);
  }, [state?.phase, state?.confess_deadline, room]);

  async function joinTable() {
    setError(null);
    try {
      await api(`/api/games/${gameId}/join`, { method: "POST" });
      const g = await api<GameView>(`/api/games/${gameId}`);
      setView(g);
      const st = g.state ? extractState(g) ?? extractState(g.state) : null;
      if (st) setState(st);
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
  const you = state?.you ?? null;
  const status = view?.status ?? "waiting";
  const waiting = status === "waiting" && !state;
  const aborted = status === "aborted";
  const lobbyExpiryMs = parseExpiryMs(view ?? {});
  const lobbyClock = remainingLobby(lobbyExpiryMs, now);
  useEffect(() => {
    if (!waiting || lobbyExpiryMs == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [waiting, lobbyExpiryMs]);
  const maxPlayers = view?.max_players ?? SALEM_MAX_FALLBACK;
  const minPlayers = view?.min_players ?? SALEM_MIN_PLAYERS;
  const mySeat = view?.your_seat ?? null;
  const isHost = view?.is_host ?? false;
  const canStart = isHost && waiting && players.length >= minPlayers;
  const phase: SalemPhase | null = state?.phase ?? null;
  const youAlive = you ? you.alive !== false && isSeatAlive(state, you.seat) : false;

  const connLabel =
    conn === "open" ? tg("connected") : wasOpen ? tg("reconnecting") : tg("connecting");

  const teammates = you?.is_witch ? (you.teammates ?? []) : [];
  const selectedCardId =
    selectedHandIndex != null && you ? you.hand[selectedHandIndex] ?? null : null;

  useEffect(() => {
    if (selectedCardId !== "scapegoat") setScapegoatFrom(null);
  }, [selectedCardId]);
  const myDay = phase === "day" && you != null && youAlive && you.seat === state?.current_seat;

  const myPick =
    phase === "night"
      ? nightTool === "gavel"
        ? (you?.my_gavel ?? null)
        : (you?.my_night_kill ?? null)
      : null;

  function canTargetSeat(seat: number) {
    if (conn !== "open") return false;
    if (!you || !youAlive) return false;
    if (!phase || phase === "over" || phase === "confess" || phase === "conspiracy" || phase === "town_hall") return false;
    if (!isSeatAlive(state, seat)) return false;
    if (phase === "day" && myDay && selectedCardId) {
      if (cardForbidsSelf(selectedCardId) && seat === you.seat) return false;
      if (selectedCardId === "scapegoat") {
        if (seat === you.seat) return false;
        if (scapegoatFrom != null) return seat !== scapegoatFrom;
      }
      return true;
    }
    if (phase === "night") {
      if (you.is_witch && you.is_constable) {
        if (nightTool === "gavel") return seat !== you.seat;
        return true;
      }
      if (you.is_witch) return true;
      if (you.is_constable) return seat !== you.seat;
      return false;
    }
    return false;
  }

  function actionLabel(): string {
    if (selectedCardId === "scapegoat" && scapegoatFrom == null) return t("pickFromSeat");
    if (selectedCardId) return t("playOn");
    if (phase === "night" && you?.is_witch && you?.is_constable) {
      return nightTool === "gavel" ? t("gavel") : t("kill");
    }
    if (phase === "night" && you?.is_witch) return t("kill");
    if (phase === "night" && you?.is_constable) return t("gavel");
    return "";
  }

  function finishPlay(cardId: string, target: number | undefined, extra: Record<string, unknown>) {
    const payload: Record<string, unknown> = { card_id: cardId };
    if (target != null) payload.target = target;
    if (Object.keys(extra).length) payload.extra = extra;
    playSalemCard();
    sendAction("play_card", payload);
    setSelectedHandIndex(null);
    setTryalPrompt(null);
    setScapegoatFrom(null);
  }

  function onSeatActivate(seat: number) {
    if (!canTargetSeat(seat) || !you) return;
    if (phase === "day" && selectedCardId) {
      if (selectedCardId === "scapegoat") {
        if (scapegoatFrom == null) {
          setScapegoatFrom(seat);
          return;
        }
        const extra: Record<string, unknown> = { from_seat: scapegoatFrom };
        const moved = marksOf(state, scapegoatFrom);
        const newMarks = marksOf(state, seat) + moved;
        if (newMarks >= MARK_THRESHOLD) {
          const open = openPublicTryals(seat);
          if (open.length) {
            setTryalPrompt({ cardId: selectedCardId, target: seat, extra });
            return;
          }
        }
        finishPlay(selectedCardId, seat, extra);
        return;
      }
      const extra: Record<string, unknown> = {};
      const add = accusationValue(selectedCardId);
      const newMarks = marksOf(state, seat) + add;
      const wouldReveal = add > 0 && newMarks >= MARK_THRESHOLD;
      if (wouldReveal) {
        const open = openPublicTryals(seat);
        if (open.length) {
          setTryalPrompt({ cardId: selectedCardId, target: seat, extra });
          return;
        }
      }
      finishPlay(selectedCardId, seat, extra);
      return;
    }
    if (phase === "night") {
      const useGavel =
        you.is_constable && (!you.is_witch || nightTool === "gavel");
      if (useGavel) {
        playSalemGavel();
        sendAction("gavel", { target: seat });
        return;
      }
      if (you.is_witch) {
        playSalemNight();
        sendAction("night_kill", { target: seat });
      }
    }
  }

  function onCardClick(cardId: string, index: number) {
    if (!myDay || conn !== "open") return;
    if (selectedHandIndex === index) {
      setSelectedHandIndex(null);
      return;
    }
    if (!cardNeedsTarget(cardId)) {
      playSalemCard();
      sendAction("play_card", { card_id: cardId });
      setSelectedHandIndex(null);
      return;
    }
    setSelectedHandIndex(index);
  }

  function cardCopy(id: string) {
    const info = playCardInfo(id);
    const k = cardI18nKey(id);
    if (k) {
      try {
        return { title: t(`cards.${k}.title`), text: t(`cards.${k}.text`), color: info.color };
      } catch {
        /* fall through */
      }
    }
    return { title: info.title, text: info.text, color: info.color };
  }

  function tryalLabel(id: string) {
    const kind = tryalKindFromId(id);
    if (kind === "witch") return t("tryalWitch");
    if (kind === "constable") return t("tryalConstable");
    return t("tryalInnocent");
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

  const remainingTryals = unrevealedOwnIndexes(you);
  const alreadyConfessed = confessedLocal;
  const alreadyConspiracy = you?.my_conspiracy_pick != null;
  const showConfessOverlay = phase === "confess" && !!you && youAlive;
  const showConspiracyOverlay = phase === "conspiracy" && !!you && youAlive;
  const nSeats = seatCount(state);
  const conspiracySource =
    you != null && nSeats > 0 ? leftSeat(you.seat, nSeats) : null;
  const conspiracyIndexes =
    conspiracySource != null
      ? openPublicTryals(conspiracySource)
      : [];

  const phaseTitle =
    phase === "day"
      ? t("phaseDay")
      : phase === "conspiracy"
        ? t("phaseConspiracy")
        : phase === "night"
          ? t("phaseNight")
          : phase === "confess"
            ? t("phaseConfess")
            : phase === "town_hall"
              ? t("phaseTownHall")
              : phase === "over"
                ? t("gameOver")
                : "";

  const phaseHint = !you
    ? t("spectatorHint")
    : !youAlive
      ? t("spectatorHint")
      : phase === "day"
        ? state?.current_seat === you.seat
          ? selectedCardId === "scapegoat" && scapegoatFrom == null
            ? t("pickFrom")
            : selectedCardId
              ? t("pickTarget")
              : t("yourTurnHint")
          : t("waitingTurn", { name: nameOf(players, state?.current_seat ?? -1) })
        : phase === "conspiracy"
          ? alreadyConspiracy
            ? t("waitingConspiracy")
            : t("conspiracyHint")
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
              ? alreadyConfessed
                ? t("waitingConfess")
                : t("confessHint")
              : phase === "town_hall"
                ? (you.town_hall_options ?? []).length
                  ? t("hallPickHint")
                  : t("hallPickedWait")
                : "";

  const winnerRole = state?.result?.winner_role;
  const iWon =
    state?.result != null && you != null && state.result.winner_seats.includes(you.seat);

  const secondsLeft =
    confessUntil != null ? Math.max(0, Math.ceil((confessUntil - now) / 1000)) : null;

  const witchSeats: number[] = state?.result
    ? Object.entries(state.result.roles ?? {})
        .filter(([, r]) => r === "witch")
        .map(([s]) => Number(s))
    : [];

  return (
    <div className="salem-root grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="mx-auto w-full max-w-2xl">
        {rematchOffer && (
          <div className="card mb-4 flex items-center justify-between gap-3 border-[var(--accent)] p-4">
            <span>
              🔁 <span className="font-bold">{rematchOffer.by}</span> {tg("rematchOffer")}
            </span>
            <button
              className="btn btn-primary"
              disabled={rematchBusy}
              onClick={async () => {
                setRematchBusy(true);
                try {
                  await joinRematchTable(rematchOffer.game_id);
                  router.push(`/game/${rematchOffer.game_id}`);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "join failed");
                  setRematchBusy(false);
                }
              }}
            >
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

        {aborted ? (
          <div className="salem-lobby card overflow-hidden p-6 text-center">
            <h2 className="text-xl font-bold">🕯 {t("title")}</h2>
            <p className="muted mt-2">{t("lobbyExpired")}</p>
            <Link href="/lobby" className="btn btn-primary mt-4">
              {tg("backToLobby")}
            </Link>
          </div>
        ) : waiting ? (
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
              {lobbyClock && (
                <p
                  className={`lobby-ttl mb-2 ${lobbyClock.expired ? "is-expired" : lobbyClock.urgent ? "is-urgent" : ""}`}
                >
                  {lobbyClock.expired
                    ? t("lobbyExpired")
                    : t("expiresIn", { time: lobbyClock.label })}
                </p>
              )}
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
                deckLabel={t("deck")}
                discardLabel={t("discard")}
                onActivate={() => undefined}
                onReport={reportPlayer}
                showWitchMarks={false}
                teammates={[]}
              />
              {view && mySeat == null && !(lobbyClock?.expired) && (
                <button className="btn btn-primary mt-4 w-full" onClick={joinTable}>
                  {tg("join")}
                </button>
              )}
              {canStart && !(lobbyClock?.expired) && (
                <button className="btn btn-primary mt-4 w-full" onClick={start}>
                  ▶ {tg("start")}
                </button>
              )}
              {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            </div>
          </div>
        ) : !state ? (
          <div className="card p-6 text-center">
            <p className="muted">{tg("connecting")}</p>
          </div>
        ) : (
          <>
            <div
              key={state.phase}
              className={`salem-phase-banner mb-4 ${
                state.phase === "night" || state.phase === "confess"
                  ? "is-night"
                  : state.phase === "conspiracy"
                    ? "is-dawn"
                    : state.phase === "over"
                      ? "is-over"
                      : "is-turn"
              }`}
            >
              <p className="salem-phase-title">
                {state.phase === "night"
                  ? `☾ ${phaseTitle}`
                  : state.phase === "conspiracy"
                    ? `↻ ${phaseTitle}`
                    : state.phase === "confess"
                      ? `⚖ ${phaseTitle}`
                      : state.phase === "over"
                        ? `🏁 ${phaseTitle}`
                        : `🕯 ${phaseTitle}`}
              </p>
              <p className="muted mt-0.5 text-sm">
                {t("round")} {state.round}
                {state.phase === "day" && state.current_seat != null && (
                  <>
                    {" · "}
                    {t("seatTurn", { name: nameOf(players, state.current_seat) })}
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
                <p
                  className={`mt-1 text-xl font-extrabold ${
                    you.is_witch ? "text-red-400" : "text-[var(--accent)]"
                  }`}
                >
                  {you.is_witch ? t("roleWitch") : t("roleTown")}
                  {you.is_constable ? ` · ${t("roleConstable")}` : ""}
                </p>
                {you.is_witch && (
                  <p className="muted mt-1 text-xs">
                    🤝 {t("teammates")}:{" "}
                    {teammates
                      .filter((s) => s !== you.seat)
                      .map((s) => nameOf(players, s))
                      .join(", ") || "—"}
                  </p>
                )}
                {!youAlive && <p className="mt-2 text-sm text-zinc-300">✝ {t("spectatorBanner")}</p>}
                {youAlive && phase !== "over" && <p className="muted mt-2 text-xs">{phaseHint}</p>}
                {phase === "night" && youAlive && you.is_witch && you.is_constable && (
                  <div className="mt-3 flex gap-2">
                    <button
                      className={`btn ${nightTool === "kill" ? "btn-primary" : "btn-ghost"} !py-1 !px-3 text-sm`}
                      onClick={() => setNightTool("kill")}
                    >
                      {t("kill")}
                    </button>
                    <button
                      className={`btn ${nightTool === "gavel" ? "btn-primary" : "btn-ghost"} !py-1 !px-3 text-sm`}
                      onClick={() => setNightTool("gavel")}
                    >
                      {t("gavel")}
                    </button>
                  </div>
                )}
                {(you.tryals ?? []).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(you.tryals ?? []).map((tr, i) => (
                      <span
                        key={i}
                        className={`salem-own-tryal ${
                          tr.revealed
                            ? tryalKindFromId(tr.id) === "innocent"
                              ? "is-town"
                              : `is-${tryalKindFromId(tr.id)}`
                            : "is-hidden"
                        }`}
                        title={tr.revealed ? tryalLabel(tr.id) : t("tryalHidden")}
                      >
                        {tr.revealed ? tryalLabel(tr.id) : t("tryalHidden")}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!you && state.phase !== "over" && (
              <div className="card mb-4 border-zinc-700 bg-[#12141a] p-4">
                <p className="text-sm">👁 {t("spectatorBanner")}</p>
                <p className="muted mt-1 text-xs">{t("spectatorHint")}</p>
              </div>
            )}

            {state.last_night && state.phase !== "night" && (
              <div className="card mb-4 p-4 text-sm">
                ☾ {t("nightResult")}{" "}
                {state.last_night.killed != null ? (
                  <span className="text-red-400">
                    {t("someoneDied", { name: nameOf(players, state.last_night.killed) })}
                  </span>
                ) : (
                  <span className="text-emerald-400">{t("nobodyDied")}</span>
                )}
              </div>
            )}

            {state.last_reveal && (
              <div className="card mb-4 p-3 text-sm">
                ⚖ {t("lastReveal", { name: nameOf(players, state.last_reveal.seat) })}{" "}
                <span className="font-semibold">{tryalLabel(state.last_reveal.id)}</span>
              </div>
            )}

            <SalemTable
              slots={orderedSeats}
              state={state}
              phase={state.phase}
              youSeat={you?.seat ?? mySeat}
              userId={user?.id}
              selected={scapegoatFrom ?? myPick}
              targetable={canTargetSeat}
              actionLabel={youAlive ? actionLabel() : ""}
              youMarker={t("youMarker")}
              emptyLabel={t("emptySeat")}
              deadLabel={t("dead")}
              accusationsLabel={t("accusations")}
              deckLabel={t("deck")}
              discardLabel={t("discard")}
              hourglass={state.phase === "confess"}
              hourglassSeconds={
                confessUntil ? Math.max(0, Math.round((confessUntil - now) / 1000)) : 0
              }
              hourglassLabel={
                secondsLeft != null
                  ? t("confessCountdown", { seconds: secondsLeft })
                  : t("confessTitle")
              }
              onActivate={onSeatActivate}
              onReport={reportPlayer}
              showWitchMarks={!!you?.is_witch}
              teammates={teammates}
            />

            {you && youAlive && (you.hand ?? []).length >= 0 && (
              <div className="salem-hand">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{t("handTitle")}</h3>
                  {selectedCardId && (
                    <button
                      className="btn btn-ghost !py-1 !px-2 text-xs"
                      onClick={() => setSelectedHandIndex(null)}
                    >
                      {t("cancelCard")}
                    </button>
                  )}
                </div>
                <p className="muted mb-1 text-xs">
                  {myDay
                    ? selectedCardId
                      ? t("pickTarget")
                      : t("playHint")
                    : t("handIdle")}
                </p>
                <div className="salem-hand-row">
                  {(you.hand ?? []).length === 0 && <p className="muted text-sm">{t("emptyHand")}</p>}
                  {(you.hand ?? []).map((cardId, i) => {
                    const copy = cardCopy(cardId);
                    return (
                      <button
                        type="button"
                        key={`${cardId}-${i}`}
                        className={`salem-card is-${copy.color} ${
                          selectedHandIndex === i ? "is-selected" : ""
                        }`}
                        style={{ animationDelay: `${i * 70}ms` }}
                        onClick={() => onCardClick(cardId, i)}
                        disabled={!myDay || conn !== "open"}
                      >
                        <span className="salem-card-color">{t(`color.${copy.color}`)}</span>
                        <span className="salem-card-title">{copy.title}</span>
                        <span className="salem-card-text">{copy.text}</span>
                      </button>
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
        {state && <p className="muted px-1 text-[11px]">{t("rulesBlurb")}</p>}
      </div>

      {tryalPrompt && (
        <div className="salem-overlay">
          <div className="result-pop salem-parchment-card relative w-full max-w-sm p-6 text-center">
            <h2 className="text-xl font-extrabold">{t("pickTryalTitle")}</h2>
            <p className="muted mt-2 text-sm">
              {t("pickTryalHint", { name: nameOf(players, tryalPrompt.target) })}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {openPublicTryals(tryalPrompt.target).map((idx) => (
                <button
                  key={idx}
                  className="btn btn-primary"
                  onClick={() =>
                    finishPlay(tryalPrompt.cardId, tryalPrompt.target, {
                      ...tryalPrompt.extra,
                      tryal_index: idx,
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
                setSelectedHandIndex(null);
              }}
            >
              {t("cancelCard")}
            </button>
          </div>
        </div>
      )}

      {showConspiracyOverlay && (
        <div className="salem-overlay">
          <div className="result-pop salem-parchment-card relative w-full max-w-sm p-6 text-center">
            <h2 className="text-xl font-extrabold">↻ {t("phaseConspiracy")}</h2>
            <p className="muted mt-2 text-sm">
              {alreadyConspiracy
                ? t("waitingConspiracy")
                : conspiracySource != null
                  ? t("pickTryalHint", { name: nameOf(players, conspiracySource) })
                  : t("conspiracyHint")}
            </p>
            {!alreadyConspiracy && (
              <div className="mt-4 flex flex-col gap-2">
                {conspiracyIndexes.length === 0 && (
                  <p className="muted text-sm">{t("noTryalsLeft")}</p>
                )}
                {conspiracyIndexes.map((idx) => (
                  <button
                    key={idx}
                    className="btn btn-primary"
                    onClick={() => {
                      playSalemCard();
                      sendAction("conspiracy_take", { tryal_index: idx });
                    }}
                  >
                    {t("tryalN", { n: idx + 1 })}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {phase === "town_hall" && you && youAlive && (
        <div className="salem-overlay">
          <div className="result-pop salem-parchment-card relative w-full max-w-md p-6 text-center">
            <h2 className="text-xl font-extrabold">🕯 {t("hallPickTitle")}</h2>
            <p className="muted mt-2 text-sm">
              {(you.town_hall_options ?? []).length ? t("hallPickHint") : t("hallPickedWait")}
            </p>
            {(you.town_hall_options ?? []).length > 0 && (
              <div className="salem-hall-pick">
                {(you.town_hall_options ?? []).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className="salem-hall-choice"
                    onClick={() => {
                      playSalemCard();
                      sendAction("choose_town_hall", { character_id: opt.id });
                    }}
                  >
                    {hallPortrait(opt.id) && (
                      <img className="salem-hall-choice-face" src={hallPortrait(opt.id)!} alt="" />
                    )}
                    <span className="salem-hall-choice-kicker">{t(`hallRoles.${townHallI18nKey(opt.id)}`)}</span>
                    <span className="salem-hall-choice-title">{t(`halls.${townHallI18nKey(opt.id)}`)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showConfessOverlay && (
        <div className="salem-overlay">
          <div className="result-pop salem-parchment-card relative w-full max-w-sm p-6 text-center">
            <h2 className="text-xl font-extrabold">⚖ {t("confessTitle")}</h2>
            <p className="muted mt-2 text-sm">
              {alreadyConfessed ? t("waitingConfess") : t("confessHint")}
            </p>
            {secondsLeft != null && (
              <p className="salem-countdown mt-3" aria-live="polite">
                {t("confessCountdown", { seconds: secondsLeft })}
              </p>
            )}
            {!alreadyConfessed && (
              <div className="mt-4 flex flex-col gap-2">
                {remainingTryals.length === 0 && (
                  <p className="muted text-sm">{t("noTryalsLeft")}</p>
                )}
                {remainingTryals.map((idx) => (
                  <button
                    key={idx}
                    className="btn btn-primary"
                    onClick={() => {
                      setConfessedLocal(true);
                      playSalemReveal();
                      sendAction("confess", { tryal_index: idx });
                    }}
                  >
                    {t("confessReveal", {
                      n: idx + 1,
                      kind: tryalLabel(you!.tryals[idx].id),
                    })}
                  </button>
                ))}
                <button
                  className="btn btn-ghost mt-1"
                  onClick={() => {
                    setConfessedLocal(true);
                    sendAction("confess_skip", {});
                  }}
                >
                  {t("confessSkip")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {state?.result && !resultDismissed && (
        <div className="salem-overlay">
          <div className="result-pop salem-parchment-card relative w-full max-w-sm p-6 text-center">
            <div
              className={`mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-4xl ${
                iWon ? "trophy-glow" : ""
              }`}
            >
              {winnerRole === "witches" ? "☾" : "☀"}
            </div>
            <h2 className="text-2xl font-extrabold text-[var(--accent)]">
              {winnerRole === "witches" ? t("witchesWon") : t("townWon")}
            </h2>
            <p className="muted mt-1 text-xs">{t("winnerTeam")}</p>
            {you && (
              <p className="mt-2 text-sm font-semibold">{iWon ? t("youWon") : t("youLost")}</p>
            )}
            <p className="muted mt-2 text-sm">
              {state.result.winner_seats.map((s) => nameOf(players, s)).join(", ")}
            </p>
            {witchSeats.length > 0 && (
              <ul className="mt-4 space-y-1 text-start text-sm">
                <li className="muted text-xs uppercase tracking-wide">{t("everWitch")}</li>
                {witchSeats.map((s) => (
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
