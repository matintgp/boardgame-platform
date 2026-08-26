"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ensureSession, type SessionUser } from "@/lib/api";
import { GameSocket, type Envelope } from "@/lib/gameSocket";
import {
  playCaptureSound,
  playCheckSound,
  playGameEndSound,
  playMoveSound,
} from "@/lib/sounds";
import ChatPanel from "@/components/ChatPanel";
import VoicePanel from "@/components/VoicePanel";

interface MafiaState {
  phase: "night" | "day" | "over";
  round: number;
  alive: Record<string, boolean>;
  last_night: { killed: number | null; saved: boolean } | null;
  last_vote: { eliminated: number | null; tie: boolean; tally: Record<string, number>; role?: string | null } | null;
  log: Record<string, unknown>[];
  result: { reason: string; winner_role: string; winner_seats: number[] } | null;
  you: {
    seat: number;
    role: "mafia" | "doctor" | "citizen";
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
  players: PlayerInfo[];
  your_seat: number | null;
}

export default function MafiaGame({ gameId }: { gameId: string }) {
  const t = useTranslations("mafia");
  const tv = useTranslations("voice");
  const tg = useTranslations("game");
  const locale = useLocale();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [view, setView] = useState<GameView | null>(null);
  const [state, setState] = useState<MafiaState | null>(null);
  const [conn, setConn] = useState<"connecting" | "open" | "closed">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [socket, setSocket] = useState<GameSocket | null>(null);
  const [resultDismissed, setResultDismissed] = useState(false);
  const socketRef = useRef<GameSocket | null>(null);
  const room = `game:${gameId}`;

  const applyEnvelope = useCallback(
    (env: Envelope) => {
      if (env.room && env.room !== room) return;
      if (env.type === "error") {
        const msg = (env.payload as { message?: string } | undefined)?.message;
        setError(msg ?? "error");
        return;
      }
      if (env.type === "lobby_update") {
        const p = env.payload as Partial<GameView>;
        setView((prev) => (prev ? { ...prev, ...p } : ({ id: gameId, ...p } as GameView)));
      } else if (env.type === "started" || env.type === "state") {
        setError(null);
        const payload = env.payload as { players?: PlayerInfo[]; state?: MafiaState };
        if (payload.players) {
          setView((prev) => (prev ? { ...prev, players: payload.players! } : prev));
        }
        if (payload.state) {
          const prev = prevStateRef.current;
          prevStateRef.current = payload.state;
          if (prev) {
            if (payload.state.phase !== prev.phase) {
              if (payload.state.phase === "day") playCheckSound();
              else if (payload.state.phase === "night") playCaptureSound();
            }
            const over = payload.state.phase === "over" && prev.phase !== "over";
            if (over) playGameEndSound();
          }
          setState(payload.state);
        }
      }
    },
    [room, gameId]
  );
  const prevStateRef = useRef<MafiaState | null>(null);

  useEffect(() => {
    let disposed = false;
    ensureSession().then(async (u) => {
      if (!u) {
        window.location.href = "/login";
        return;
      }
      if (disposed) return;
      setUser(u);
      try {
        const g = await api<GameView>(`/api/games/${gameId}`);
        setView(g);
      } catch {
        setError("game not found");
        return;
      }
      const s = new GameSocket();
      socketRef.current = s;
      setSocket(s);
      s.onMessage(applyEnvelope);
      s.onStatus(setConn);
      s.connect();
      s.join(room);
    });
    return () => {
      disposed = true;
      socketRef.current?.close();
    };
  }, [applyEnvelope, gameId, room]);

  function act(action: string, target: number) {
    setError(null);
    socketRef.current?.send({ type: "action", room, action, payload: { target } });
  }

  const players = view?.players ?? [];
  const you = state?.you ?? null;
  const isAlive = you?.alive ?? true;
  const nameOf = (seat: number) =>
    players.find((p) => p.seat === seat)?.user.username ?? `#${seat}`;

  const roleLabel =
    you?.role === "mafia" ? t("roleMafia") : you?.role === "doctor" ? t("roleDoctor") : t("roleCitizen");

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr]">
      {/* Rematch offer */}
      {view && view.status !== undefined && null}
      {/* Main */}
      <div className="mx-auto w-full max-w-md">
        {/* Role badge */}
        <div
          className={`card mb-4 flex items-center justify-between p-4 ${
            you?.role === "mafia" ? "!border-red-800" : ""
          }`}
        >
          <div>
            <p className="muted text-xs uppercase tracking-wide">{t("yourRole")}</p>
            <p className={`text-lg font-extrabold ${you?.role === "mafia" ? "text-red-400" : "text-[var(--accent)]"}`}>
              {roleLabel}
            </p>
            {you?.role === "mafia" && you.teammates && (
              <p className="muted text-xs">
                🤝 {t("teammates")}: {you.teammates.map(nameOf).join(", ") || "—"}
              </p>
            )}
          </div>
          <div className="text-right text-sm">
            <p className="font-bold">
              {state?.phase === "night" ? `🌙 ${t("night")}` : state?.phase === "day" ? `☀️ ${t("day")}` : "🏁"}
            </p>
            <p className="muted">{t("round")} {state?.round ?? 1}</p>
          </div>
        </div>

        {/* Players */}
        <div className="card mb-4 p-4">
          <h3 className="mb-2 font-semibold">{t("players")}</h3>
          <div className="flex flex-col gap-2 text-sm">
            {players.map((p) => {
              const alive = state?.alive[String(p.seat)] ?? true;
              const isSelf = p.user.id === user?.id;
              // Citizens have no night action - only mafia/doctor act at night.
              const nightActor =
                state?.phase !== "night" ||
                you?.role === "mafia" ||
                you?.role === "doctor";
              const targetable =
                isAlive && you?.alive && nightActor && !isSelf && conn === "open" && state?.phase !== "over";
              const myPick =
                (state?.phase === "night" && you?.my_action === p.seat) ||
                (state?.phase === "day" && you?.my_vote === p.seat);
              return (
                <div
                  key={p.seat}
                  className={`flex items-center justify-between rounded-lg border p-2 ${
                    myPick ? "border-[var(--accent)]" : "border-[var(--border)]"
                  } ${!alive ? "opacity-50" : ""}`}
                >
                  <span>
                    {!alive && "💀 "}
                    {p.user.username}
                    {isSelf && <em className="muted ms-1">(you)</em>}
                    {!alive && <em className="muted ms-1">— {t("dead")}</em>}
                  </span>
                  {targetable && (
                    <button
                      className="btn btn-ghost !py-1 !px-2 text-xs"
                      onClick={() =>
                        act(
                          state?.phase === "night"
                            ? you?.role === "mafia"
                              ? "mafia_kill"
                              : "doctor_save"
                            : "vote",
                          p.seat
                        )
                      }
                    >
                      {state?.phase === "night"
                        ? you?.role === "mafia"
                          ? t("kill")
                          : t("save")
                        : t("vote")}
                    </button>
                  )}
                  {!isSelf && (
                    <button
                      className="btn btn-ghost !py-1 !px-2 text-xs"
                      title="Report"
                      onClick={async () => {
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
                      }}
                    >
                      ⚑
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {state?.phase === "day" && you?.alive && (
            <p className="muted mt-2 text-xs">
              {t("votesIn")}: {you.votes_in}/{you.votes_needed}
            </p>
          )}
          {you && !you.alive && (
            <p className="muted mt-2 text-xs">💀 {t("youAreDead")}</p>
          )}
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        </div>

        {/* Announcements */}
        {state?.last_night && (
          <div className="card mb-4 p-4 text-sm">
            🌙 {t("nightResult")}:{" "}
            {state.last_night.killed != null ? (
              <span className="text-red-400">
                {t("someoneDied", { name: nameOf(state.last_night.killed) })}
              </span>
            ) : (
              t("nobodyDied")
            )}
          </div>
        )}
        {state?.last_vote && (
          <div className="card mb-4 p-4 text-sm">
            ☀️ {t("voteResult")}:{" "}
            {state.last_vote.eliminated != null ? (
              <span className="text-red-400">
                {nameOf(state.last_vote.eliminated)}
                {state.last_vote.role ? ` (${state.last_vote.role})` : ""} — {t("wasEliminated")}
              </span>
            ) : (
              t("noElimination")
            )}
          </div>
        )}

        {/* Result overlay */}
        {state?.result && !resultDismissed && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="result-pop card relative w-full max-w-sm p-6 text-center">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-4xl">
                {state.result.winner_role === "mafia" ? "🔪" : "🎉"}
              </div>
              <h2 className="text-2xl font-extrabold text-[var(--accent)]">
                {state.result.winner_role === "mafia" ? t("mafiaWon") : t("citizensWon")}
              </h2>
              <p className="muted mt-2 text-sm">
                {state.result.winner_seats.map(nameOf).join(", ")}
              </p>
              <div className="mt-5 flex justify-center gap-3">
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    try {
                      const res = await api<{ game_id: string }>(
                        `/api/games/${gameId}/rematch`,
                        { method: "POST" }
                      );
                      window.location.assign(`/${locale}/game/${res.game_id}`);
                    } catch {
                      window.location.assign(`/${locale}/lobby`);
                    }
                  }}
                >
                  🔁 {tg("rematch")}
                </button>
                <button className="btn btn-ghost" onClick={() => setResultDismissed(true)}>
                  {tg("reviewBoard")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Chat */}
      <VoicePanel

        gameId={gameId}

        selfName={user?.username}

        labels={{ join: tv("join"), leave: tv("leave"), mute: tv("mute"), unmute: tv("unmute"), title: tv("title"), micError: tv("micError") }}

      />


      <ChatPanel
        socket={socket}
        selfName={user?.username}
          room={room}
        title={t("chatTitle")}
        placeholder={t("chatPlaceholder")}
        sendLabel={t("chatSend")}
      />
    </div>
  );
}
