"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ensureSession, type SessionUser } from "@/lib/api";
import { Link, useRouter } from "@/i18n/navigation";
import { GameSocket, type Envelope } from "@/lib/gameSocket";
import { playCaptureSound, playCheckSound, playGameEndSound } from "@/lib/sounds";
import ChatPanel from "@/components/ChatPanel";
import VoicePanel from "@/components/VoicePanel";

/** Engine MafiaEngine.min_players — start is allowed at min, seats go up to view.max_players. */
const MAFIA_MIN_PLAYERS = 4;
const MAFIA_MAX_FALLBACK = 8;

type Role = "mafia" | "doctor" | "citizen";
type Phase = "night" | "day" | "over";

interface MafiaState {
  phase: Phase;
  round: number;
  alive: Record<string, boolean>;
  last_night: { killed: number | null; saved: boolean } | null;
  last_vote: {
    eliminated: number | null;
    tie: boolean;
    tally: Record<string, number>;
    role?: string | null;
  } | null;
  log: Record<string, unknown>[];
  result: {
    reason: string;
    winner_role: string;
    winner_seats: number[];
    roles?: Record<string, string>;
    revealed_roles?: Record<string, string>;
  } | null;
  roles?: Record<string, string>;
  you: {
    seat: number;
    role: Role;
    alive: boolean;
    teammates?: number[];
    my_action?: number | null;
    team_ready?: boolean;
    my_vote?: number | null;
    votes_in?: number;
    votes_needed?: number;
  } | null;
}

interface PlayerInfo {
  seat: number;
  user: { id: string; username: string; rating?: number };
}

interface GameView {
  id: string;
  game_type: string;
  status: string;
  max_players?: number;
  min_players?: number;
  players: PlayerInfo[];
  your_seat: number | null;
  is_host?: boolean;
  state?: MafiaState;
}

type Conn = "connecting" | "open" | "closed";

const NIGHT_STARS = [
  { top: "12%", left: "18%", delay: "0s" },
  { top: "20%", left: "78%", delay: "0.6s" },
  { top: "28%", left: "62%", delay: "1.1s" },
  { top: "16%", left: "42%", delay: "1.7s" },
  { top: "34%", left: "22%", delay: "0.3s" },
  { top: "22%", left: "88%", delay: "2.1s" },
];

function nameOf(players: PlayerInfo[], seat: number) {
  return players.find((p) => p.seat === seat)?.user.username ?? `#${seat}`;
}

function roleKey(role: string): "roleMafia" | "roleDoctor" | "roleCitizen" {
  if (role === "mafia") return "roleMafia";
  if (role === "doctor") return "roleDoctor";
  return "roleCitizen";
}

function polar(index: number, total: number, radius = 38) {
  const n = Math.max(total, 1);
  // index 0 sits at the bottom; increasing index walks clockwise.
  const angle = Math.PI / 2 + (index / n) * 2 * Math.PI;
  return {
    left: `${50 + radius * Math.cos(angle)}%`,
    top: `${50 + radius * Math.sin(angle)}%`,
  };
}

function revealedRoles(
  state: MafiaState | null
): { seat: number; role: string }[] | null {
  const bag =
    state?.result?.roles ?? state?.result?.revealed_roles ?? state?.roles ?? null;
  if (!bag || typeof bag !== "object") return null;
  const rows = Object.entries(bag)
    .map(([s, r]) => ({ seat: Number(s), role: String(r) }))
    .filter((r) => Number.isFinite(r.seat));
  return rows.length ? rows : null;
}

export default function MafiaGame({ gameId }: { gameId: string }) {
  const t = useTranslations("mafia");
  const router = useRouter();
  const tv = useTranslations("voice");
  const tg = useTranslations("game");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [view, setView] = useState<GameView | null>(null);
  const [state, setState] = useState<MafiaState | null>(null);
  const [conn, setConn] = useState<Conn>("connecting");
  const [wasOpen, setWasOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [socket, setSocket] = useState<GameSocket | null>(null);
  const [resultDismissed, setResultDismissed] = useState(false);
  const [rematchOffer, setRematchOffer] = useState<{ game_id: string; by: string } | null>(
    null
  );
  const [rematchBusy, setRematchBusy] = useState(false);
  const socketRef = useRef<GameSocket | null>(null);
  const prevStateRef = useRef<MafiaState | null>(null);
  const hydratedRef = useRef(false);
  const seatFetchRef = useRef(false);
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
                if (g.state) setState(g.state);
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
          state?: MafiaState;
          status?: string;
        };
        setView((prev) => {
          const next = prev
            ? { ...prev }
            : ({ id: gameId, game_type: "mafia", status: "active", players: [] } as GameView);
          if (payload.players) next.players = payload.players;
          if (payload.status) next.status = payload.status;
          if (env.type === "started") next.status = "active";
          return next;
        });
        if (payload.state) {
          const prev = prevStateRef.current;
          prevStateRef.current = payload.state;
          if (hydratedRef.current && prev) {
            if (payload.state.phase !== prev.phase) {
              if (payload.state.phase === "day") playCheckSound();
              else if (payload.state.phase === "night") playCaptureSound();
            }
            if (payload.state.phase === "over" && prev.phase !== "over") {
              playGameEndSound();
            }
          }
          hydratedRef.current = true;
          setState(payload.state);
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
        if (g.state) {
          prevStateRef.current = g.state;
          hydratedRef.current = true;
          setState(g.state);
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

  function act(action: string, target: number) {
    setError(null);
    socketRef.current?.send({ type: "action", room, action, payload: { target } });
  }

  async function joinTable() {
    setError(null);
    try {
      await api(`/api/games/${gameId}/join`, { method: "POST" });
      const g = await api<GameView>(`/api/games/${gameId}`);
      setView(g);
      if (g.state) setState(g.state);
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
  const maxPlayers = view?.max_players ?? MAFIA_MAX_FALLBACK;
  const minPlayers = view?.min_players ?? MAFIA_MIN_PLAYERS;
  const mySeat = view?.your_seat ?? null;
  const isHost = view?.is_host ?? false;
  const canStart = isHost && waiting && players.length >= minPlayers;
  const phase: Phase | null = state?.phase ?? null;

  const connLabel =
    conn === "open"
      ? tg("connected")
      : wasOpen
        ? tg("reconnecting")
        : tg("connecting");

  const teammates = you?.role === "mafia" ? (you.teammates ?? []) : [];

  const myPick =
    phase === "night" ? (you?.my_action ?? null) : phase === "day" ? (you?.my_vote ?? null) : null;

  function isTeammate(seat: number) {
    if (you?.role !== "mafia") return false;
    if (you.seat === seat) return true;
    return teammates.includes(seat);
  }

  function seatAlive(seat: number) {
    return state?.alive[String(seat)] ?? true;
  }

  function canTarget(seat: number) {
    if (conn !== "open") return false;
    if (!you?.alive) return false;
    if (!phase || phase === "over") return false;
    if (!seatAlive(seat)) return false;
    if (phase === "night") {
      if (you.role === "mafia") return !isTeammate(seat);
      if (you.role === "doctor") return true;
      return false;
    }
    if (phase === "day") return true;
    return false;
  }

  function actionForPhase(): "mafia_kill" | "doctor_save" | "vote" | null {
    if (phase === "night" && you?.role === "mafia") return "mafia_kill";
    if (phase === "night" && you?.role === "doctor") return "doctor_save";
    if (phase === "day") return "vote";
    return null;
  }

  function actionLabel(): string {
    const a = actionForPhase();
    if (a === "mafia_kill") return t("kill");
    if (a === "doctor_save") return t("save");
    if (a === "vote") return t("vote");
    return "";
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

  const nightHint =
    you?.role === "mafia"
      ? t("nightHintMafia")
      : you?.role === "doctor"
        ? t("nightHintDoctor")
        : t("nightHintCitizen");

  const phaseHint = !you
    ? t("spectatorHint")
    : !you.alive
      ? t("spectatorHint")
      : phase === "night"
        ? you.role === "citizen"
          ? t("nightHintCitizen")
          : you.my_action != null
            ? t("waitingNight")
            : nightHint
        : phase === "day"
          ? you.my_vote != null
            ? t("waitingVotes")
            : t("dayHint")
          : "";

  const roles = revealedRoles(state);
  const iWon =
    state?.result != null &&
    you != null &&
    state.result.winner_seats.includes(you.seat);

  function onSeatActivate(seat: number) {
    if (!canTarget(seat)) return;
    const action = actionForPhase();
    if (!action) return;
    act(action, seat);
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

  const votesIn = you?.votes_in ?? 0;
  const votesNeeded = you?.votes_needed ?? 0;
  const votePct =
    phase === "day" && votesNeeded > 0
      ? Math.min(100, Math.round((votesIn / votesNeeded) * 100))
      : 0;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="mx-auto w-full max-w-xl">
        {rematchOffer && (
          <div className="card mb-4 flex items-center justify-between gap-3 border-[var(--accent)] p-4">
            <span>
              🔁 <span className="font-bold">{rematchOffer.by}</span> {tg("rematchOffer")}
            </span>
            <button
              className="btn btn-primary"
              onClick={() => router.push(`/game/${rematchOffer.game_id}`)}
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

        {waiting ? (
          <div className="card p-5">
            <h2 className="mb-1 text-xl font-bold">🎭 {t("title")}</h2>
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
            <TableCircle
              slots={orderedSeats}
              phase={null}
              youSeat={mySeat}
              userId={user?.id}
              aliveMap={null}
              selected={null}
              teammates={[]}
              canTarget={() => false}
              actionLabel=""
              youMarker={t("youMarker")}
              emptyLabel={t("emptySeat")}
              deadLabel={t("dead")}
              onActivate={() => undefined}
              onReport={reportPlayer}
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
            {isHost && waiting && players.length < minPlayers && (
              <p className="muted mt-3 text-center text-xs">
                {t("needMinPlayers", { count: minPlayers })}
              </p>
            )}
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          </div>
        ) : !state ? (
          <div className="card p-6 text-center">
            <p className="muted">{tg("connecting")}</p>
          </div>
        ) : (
          <>
            <div
              key={state.phase}
              className={`mafia-phase-banner mb-4 rounded-xl border px-4 py-3 text-center ${
                state.phase === "night"
                  ? "border-indigo-900 bg-[#0b0d14]"
                  : state.phase === "day"
                    ? "border-[var(--accent)]/35 bg-[#1c1912]"
                    : "border-[var(--border)] bg-[var(--surface)]"
              }`}
            >
              <p
                className={`text-2xl font-extrabold ${
                  state.phase === "night"
                    ? "text-indigo-200"
                    : state.phase === "day"
                      ? "text-[var(--accent)]"
                      : "text-[var(--text)]"
                }`}
              >
                {state.phase === "night"
                  ? `🌙 ${t("night")}`
                  : state.phase === "day"
                    ? `☀️ ${t("day")}`
                    : `🏁 ${t("gameOver")}`}
              </p>
              <p className="muted mt-0.5 text-sm">
                {t("round")} {state.round}
              </p>
            </div>

            {you && (
              <div
                className={`card mb-4 p-4 ${
                  you.role === "mafia"
                    ? "!border-red-800"
                    : !you.alive
                      ? "border-zinc-700 bg-[#12141a]"
                      : state.phase === "night"
                        ? "border-indigo-900/70 bg-[#101218]"
                        : ""
                }`}
              >
                <p className="muted text-xs uppercase tracking-wide">{t("yourRole")}</p>
                <p
                  className={`mt-1 text-2xl font-extrabold ${
                    you.role === "mafia" ? "text-red-400" : "text-[var(--accent)]"
                  }`}
                >
                  {t(roleKey(you.role))}
                </p>
                {you.role === "mafia" && (
                  <p className="muted mt-1 text-xs">
                    🤝 {t("teammates")}:{" "}
                    {teammates.map((s) => nameOf(players, s)).join(", ") || "—"}
                    {you.team_ready ? ` — ${t("teamReady")}` : ""}
                  </p>
                )}
                {!you.alive && (
                  <p className="mt-2 text-sm text-zinc-300">💀 {t("spectatorBanner")}</p>
                )}
                {you.alive && state.phase !== "over" && (
                  <p className="muted mt-2 text-xs">{phaseHint}</p>
                )}
                {state.phase === "night" && you.alive && you.role === "citizen" && (
                  <p className="mt-2 text-sm text-indigo-200">😴 {t("sleeping")}</p>
                )}
              </div>
            )}

            {!you && state.phase !== "over" && (
              <div className="card mb-4 border-zinc-700 bg-[#12141a] p-4">
                <p className="text-sm">👁 {t("spectatorBanner")}</p>
                <p className="muted mt-1 text-xs">{t("spectatorHint")}</p>
              </div>
            )}

            {state.last_night && (state.phase === "day" || state.phase === "over") && (
              <div className="card mb-4 p-4 text-sm">
                🌙 {t("nightResult")}{" "}
                {state.last_night.killed != null ? (
                  <span className="text-red-400">
                    {t("someoneDied", { name: nameOf(players, state.last_night.killed) })}
                  </span>
                ) : (
                  <span className="text-emerald-400">{t("nobodyDied")}</span>
                )}
              </div>
            )}
            {state.last_vote && (state.phase === "night" || state.phase === "over") && (
              <div className="card mb-4 p-4 text-sm">
                ☀️ {t("voteResult")}{" "}
                {state.last_vote.eliminated != null ? (
                  <span className="text-red-400">
                    {nameOf(players, state.last_vote.eliminated)} — {t("wasEliminated")}
                  </span>
                ) : (
                  t("noElimination")
                )}
              </div>
            )}

            <TableCircle
              slots={orderedSeats}
              phase={state.phase}
              youSeat={you?.seat ?? mySeat}
              userId={user?.id}
              aliveMap={state.alive}
              selected={myPick}
              teammates={teammates}
              canTarget={canTarget}
              actionLabel={you?.alive ? actionLabel() : ""}
              youMarker={t("youMarker")}
              emptyLabel={t("emptySeat")}
              deadLabel={t("dead")}
              onActivate={onSeatActivate}
              onReport={reportPlayer}
              showMafiaMarks={you?.role === "mafia"}
            />

            {state.phase === "day" && you && votesNeeded > 0 && (
              <div className="card mt-4 p-3">
                <div className="mb-1 flex justify-between text-xs">
                  <span className="muted">{t("votesIn")}</span>
                  <span>
                    {t("voteProgress", { current: votesIn, needed: votesNeeded })}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
                    style={{ width: `${votePct}%` }}
                  />
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
        />
        {state && state.log.length > 0 && (
          <div className="card max-h-64 overflow-auto p-4">
            <h3 className="mb-2 font-semibold">{t("logTitle")}</h3>
            <ol className="flex flex-col gap-2 text-xs">
              {state.log.map((entry, i) => (
                <LogLine key={i} entry={entry} players={players} t={t} />
              ))}
            </ol>
          </div>
        )}
      </div>

      {state?.result && !resultDismissed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="result-pop card relative w-full max-w-sm p-6 text-center">
            <div
              className={`mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-4xl ${
                iWon ? "trophy-glow" : ""
              }`}
            >
              {state.result.winner_role === "mafia" ? "🔪" : "🎉"}
            </div>
            <h2 className="text-2xl font-extrabold text-[var(--accent)]">
              {state.result.winner_role === "mafia" ? t("mafiaWon") : t("citizensWon")}
            </h2>
            <p className="muted mt-1 text-xs">{t("winnerTeam")}</p>
            {you && (
              <p className="mt-2 text-sm font-semibold">
                {iWon ? t("youWon") : t("youLost")}
              </p>
            )}
            <p className="muted mt-2 text-sm">
              {state.result.winner_seats.map((s) => nameOf(players, s)).join(", ")}
            </p>
            {roles ? (
              <ul className="mt-4 space-y-1 text-start text-sm">
                <li className="muted text-xs uppercase tracking-wide">{t("rolesTitle")}</li>
                {roles.map((r) => (
                  <li key={r.seat} className="flex justify-between gap-2">
                    <span>{nameOf(players, r.seat)}</span>
                    <span className={r.role === "mafia" ? "text-red-400" : ""}>
                      {t(roleKey(r.role))}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="mt-4 space-y-1 text-start text-sm">
                <li className="muted text-xs uppercase tracking-wide">{t("rolesTitle")}</li>
                {players.map((p) => {
                  const winner = state.result!.winner_seats.includes(p.seat);
                  const team = winner
                    ? state.result!.winner_role
                    : state.result!.winner_role === "mafia"
                      ? "citizens"
                      : "mafia";
                  return (
                    <li key={p.seat} className="flex justify-between gap-2">
                      <span>
                        {p.user.username}
                        {p.user.id === user?.id && (
                          <em className="muted ms-1">{t("youMarker")}</em>
                        )}
                      </span>
                      <span className={team === "mafia" ? "text-red-400" : ""}>
                        {team === "mafia" ? t("roleMafia") : t("townTeam")}
                      </span>
                    </li>
                  );
                })}
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

function TableCircle({
  slots,
  phase,
  youSeat,
  userId,
  aliveMap,
  selected,
  teammates,
  canTarget,
  actionLabel,
  youMarker,
  emptyLabel,
  deadLabel,
  onActivate,
  onReport,
  showMafiaMarks = false,
}: {
  slots: { seat: number; player: PlayerInfo | null }[];
  phase: Phase | null;
  youSeat: number | null;
  userId: string | undefined;
  aliveMap: Record<string, boolean> | null;
  selected: number | null;
  teammates: number[];
  canTarget: (seat: number) => boolean;
  actionLabel: string;
  youMarker: string;
  emptyLabel: string;
  deadLabel: string;
  onActivate: (seat: number) => void;
  onReport: (p: PlayerInfo) => void;
  showMafiaMarks?: boolean;
}) {
  const n = slots.length;
  const tableClass =
    phase === "night"
      ? "is-night"
      : phase === "day"
        ? "is-day"
        : phase === "over"
          ? "is-over"
          : "";

  return (
    <div
      className={`mafia-table mx-auto aspect-square w-full max-w-[28rem] rounded-full ${tableClass}`}
      dir="ltr"
    >
      {phase === "night" &&
        NIGHT_STARS.map((s, i) => (
          <span
            key={i}
            className="mafia-star"
            style={{ top: s.top, left: s.left, animationDelay: s.delay }}
          />
        ))}
      <div className="pointer-events-none absolute inset-[32%] flex flex-col items-center justify-center rounded-full border border-white/5 text-center">
        <span className="text-3xl" aria-hidden>
          {phase === "night" ? "🌙" : phase === "day" ? "☀️" : phase === "over" ? "🏁" : "🎭"}
        </span>
      </div>
      {slots.map((slot, i) => {
        const pos = polar(i, n);
        const p = slot.player;
        const isSelf = p ? p.user.id === userId || slot.seat === youSeat : slot.seat === youSeat;
        const alive = p && aliveMap ? (aliveMap[String(slot.seat)] ?? true) : true;
        const picked = selected === slot.seat;
        const targetable = p != null && canTarget(slot.seat);
        const mate = showMafiaMarks && teammates.includes(slot.seat);
        const chip = (
          <div
            className={`flex w-[4.6rem] flex-col items-center ${!alive ? "opacity-45" : ""}`}
          >
            <span
              className={`relative flex h-14 w-14 items-center justify-center rounded-full border-2 text-lg font-bold transition ${
                picked
                  ? "border-[var(--accent)] bg-[rgba(212,162,78,0.2)] scale-105"
                  : isSelf
                    ? "border-[var(--accent)] bg-[var(--surface)]"
                    : mate
                      ? "border-red-700 bg-[#1a1010]"
                      : p
                        ? "border-[var(--border)] bg-[var(--surface)]"
                        : "border-dashed border-[var(--border)] bg-black/20"
              } ${targetable ? "cursor-pointer hover:border-[var(--accent)]" : ""} ${
                !alive ? "grayscale" : ""
              }`}
            >
              {!alive && (
                <span className="absolute -top-1 -right-1 text-sm" aria-hidden>
                  💀
                </span>
              )}
              {p ? (p.user.username.slice(0, 1) || "?").toUpperCase() : "·"}
            </span>
            <span className="mt-1 max-w-full truncate text-center text-[11px] leading-tight">
              {p ? p.user.username : emptyLabel}
            </span>
            {isSelf && p && <em className="muted text-[10px]">{youMarker}</em>}
            {!alive && p && <em className="muted text-[10px]">— {deadLabel}</em>}
            {targetable && actionLabel && (
              <span className="mt-0.5 text-[10px] font-semibold text-[var(--accent)]">
                {actionLabel}
              </span>
            )}
          </div>
        );

        return (
          <div
            key={p ? `p-${p.seat}` : `empty-${slot.seat}`}
            className="absolute z-[1] -translate-x-1/2 -translate-y-1/2"
            style={pos}
          >
            {targetable ? (
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
  const phase = String(entry.phase ?? "");
  if (phase === "night") {
    const killed = entry.killed;
    const text =
      killed == null
        ? t("nobodyDied")
        : t("someoneDied", { name: nameOf(players, Number(killed)) });
    return (
      <li>
        <span className="muted">
          {t("round")} {round} · {t("night")}
        </span>
        <div>🌙 {text}</div>
      </li>
    );
  }
  if (phase === "day") {
    const eliminated = entry.eliminated;
    const tie = Boolean(entry.tie);
    return (
      <li>
        <span className="muted">
          {t("round")} {round} · {t("day")}
        </span>
        <div>
          ☀️{" "}
          {eliminated == null || tie
            ? t("noElimination")
            : `${nameOf(players, Number(eliminated))} — ${t("wasEliminated")}`}
        </div>
      </li>
    );
  }
  return null;
}
