"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ensureSession, type SessionUser } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";
import { GameSocket, type Envelope } from "@/lib/gameSocket";
import ChatPanel from "@/components/ChatPanel";
import VoicePanel from "@/components/VoicePanel";
import LobbyExpiryNote, { lobbyTimedOut } from "@/components/LobbyExpiryNote";
import {
  playCaptureSound,
  playCheckSound,
  playGameEndSound,
  playMoveSound,
} from "@/lib/sounds";

interface RokuganState {
  round: number;
  phase: "choose" | "over";
  provinces: Record<string, boolean[]>;
  log: { round: number; outcomes: { attacker: number; target: number; attack: number; defended: boolean; defense: number | null; razed: boolean }[] }[];
  result: { reason: string; winner_seat: number | null } | null;
  you: { seat: number; plan: { attack: { target: number; token: number }; defense: { target: number; token: number } } | null } | null;
  opponent: { submitted: boolean } | null;
}

interface PlayerInfo {
  seat: number;
  user: { id: string; username: string; rating?: number };
}

interface GameView {
  id: string;
  game_type: string;
  status: string;
  max_players: number;
  players: PlayerInfo[];
  your_seat: number | null;
  is_host?: boolean;
  created_at?: string | number | null;
  expires_at?: string | number | null;
}

const TOKENS = [1, 2, 3, 4, 5];

export default function RokuganGame({ gameId }: { gameId: string }) {
  const t = useTranslations("rokugan");
  const router = useRouter();
  const tc = useTranslations("chat");
  const tv = useTranslations("voice");
  const tg = useTranslations("game");
  const tl = useTranslations("lobby");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [view, setView] = useState<GameView | null>(null);
  const [state, setState] = useState<RokuganState | null>(null);
  const [conn, setConn] = useState<"connecting" | "open" | "closed">("connecting");
  const [attack, setAttack] = useState<{ target: number; token: number } | null>(null);
  const [defense, setDefense] = useState<{ target: number; token: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultDismissed, setResultDismissed] = useState(false);
  const socketRef = useRef<GameSocket | null>(null);
  const [socket, setSocket] = useState<GameSocket | null>(null);
  const hydratedRef = useRef(false);
  const lastSeqRef = useRef(0);
  const room = `game:${gameId}`;

  const players = view?.players ?? [];
  const mySeat = view?.your_seat ?? undefined;
  const oppSeat = mySeat === 0 ? 1 : 0;

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
        const payload = env.payload as {
          players?: PlayerInfo[];
          state?: RokuganState;
          events?: { type: string }[];
        };
        if (payload.players) {
          setView((prev) => (prev ? { ...prev, players: payload.players! } : prev));
        }
        if (payload.state) {
          const seq = env.seq ?? 0;
          const isLive = hydratedRef.current && seq > lastSeqRef.current;
          if (seq > lastSeqRef.current) lastSeqRef.current = seq;
          const over = payload.events?.some((e) => e.type === "game_over");
          const reveal = payload.events?.some((e) => e.type === "reveal");
          if (isLive) {
            if (over) playGameEndSound();
            else if (reveal) playCaptureSound();
            else playMoveSound(true);
          }
          setState(payload.state);
          hydratedRef.current = true;
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
      } catch {
        setError("game not found");
        return;
      }
      const socket = new GameSocket();
      socketRef.current = socket;
      setSocket(socket);
      socket.onMessage(applyEnvelope);
      socket.onStatus(setConn);
      socket.connect();
      socket.join(room);
    });
    return () => {
      disposed = true;
      socketRef.current?.close();
    };
  }, [applyEnvelope, gameId, room]);

  async function joinTable() {
    setError(null);
    try {
      await api(`/api/games/${gameId}/join`, { method: "POST" });
      const g = await api<GameView>(`/api/games/${gameId}`);
      setView(g);
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

  async function submitPlan() {
    setError(null);
    if (!attack || !defense) {
      setError(t("pickBoth"));
      return;
    }
    if (attack.token === defense.token) {
      setError(t("sameToken"));
      return;
    }
    try {
      await api(`/api/games/${gameId}/action`, {
        method: "POST",
        body: JSON.stringify({
          action: "plan",
          payload: { attack, defense },
        }),
      });
      setAttack(null);
      setDefense(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    }
  }

  function Province({
    ownerSeat,
    idx,
    clickable,
    selected,
    razed,
    label,
  }: {
    ownerSeat: number;
    idx: number;
    clickable: boolean;
    selected: boolean;
    razed: boolean;
    label: string;
  }) {
    return (
      <button
        disabled={!clickable}
        onClick={() => {
          if (ownerSeat === oppSeat) {
            setAttack((a) => ({ target: idx, token: a?.token ?? 3 }));
          } else {
            setDefense((d) => ({ target: idx, token: d?.token ?? 3 }));
          }
        }}
        className={`relative flex h-20 w-[4.6rem] flex-col items-center justify-center rounded-md border-2 text-2xl transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
          razed
            ? "border-red-800 bg-[#2a1616] text-red-300/90"
            : selected
              ? "border-[var(--accent)] bg-[#3d4a2c] shadow-[0_0_0_2px_rgba(212,162,78,0.4)]"
              : "border-[#5a4a32] bg-[#2a241c]"
        } ${clickable ? "cursor-pointer hover:border-[var(--accent)]" : "opacity-80"}`}
      >
        <span>{razed ? "💥" : "⛩"}</span>
        <span className={`mt-0.5 text-[11px] font-semibold leading-tight ${razed ? "text-red-300/80" : ""}`}>
          {label}
        </span>
      </button>
    );
  }

  const myProvinces = state?.provinces?.[String(mySeat ?? 0)] ?? [false, false, false];
  const oppProvinces = state?.provinces?.[String(oppSeat ?? 1)] ?? [false, false, false];
  const canPlan =
    state?.phase === "choose" && mySeat != null && conn === "open";
  const alreadySubmitted = state?.you?.plan != null;
  const waiting = (view?.status ?? "waiting") === "waiting" || !state || players.length < 2;
  const timedOut = lobbyTimedOut(view?.status, view?.expires_at, view?.created_at);
  const maxPlayers = view?.max_players ?? 2;
  const canStart = (view?.is_host ?? false) && waiting && players.length >= maxPlayers && !timedOut;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr]">
      {/* Result overlay */}
      {state?.result && !resultDismissed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="result-pop card relative w-full max-w-sm p-6 text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-4xl">
              {state.result.winner_seat == null ? "🤝" : "🏆"}
            </div>
            <h2 className="text-2xl font-extrabold text-[var(--accent)]">
              {state.result.winner_seat == null
                ? t("drawTitle")
                : state.result.winner_seat === mySeat
                  ? t("victory")
                  : t("defeat")}
            </h2>
            <p className="muted mt-2 text-sm">{t("resultLine")}</p>
            <div className="mt-5 flex justify-center gap-3">
              <button
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    const res = await api<{ game_id: string }>(
                      `/api/games/${gameId}/rematch`,
                      { method: "POST" }
                    );
                    router.push(`/game/${res.game_id}`);
                  } catch {
                    router.push("/lobby");
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

      {/* Battle board */}
      <div className="mx-auto flex flex-col items-center gap-4">
        {waiting ? (
          <div className="card w-full max-w-md p-5">
            <h2 className="mb-3 text-xl font-bold">⚔ {t("title")}</h2>
            <p className="muted mb-2 text-sm">
              ⏳ {tg("waiting")} ({players.length}/{maxPlayers})
            </p>
            <div className="mb-4">
              <LobbyExpiryNote
                expiresAt={view?.expires_at}
                createdAt={view?.created_at}
                status={view?.status}
                expiredLabel={tl("expired")}
                expiresIn={(p) => tl("expiresIn", p)}
              />
            </div>
            <div className="flex flex-col gap-2 text-sm">
              {players.map((p) => (
                <div key={p.seat} className="flex justify-between rounded-lg border border-[var(--border)] p-2">
                  <span>
                    {p.user.username}
                    {p.user.id === user?.id && <em className="muted ms-1">{t("youMarker")}</em>}
                  </span>
                </div>
              ))}
            </div>
            {view && mySeat == null && !timedOut && (
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
        ) : (
        <>
        <div className="card flex items-center gap-2 p-3 text-sm">
          <span className="font-bold">{players.find((p) => p.seat === oppSeat)?.user.username ?? "..."}</span>
          <span className="muted">
            {state?.opponent?.submitted ? `✍️ ${t("opponentReady")}` : t("opponentThinking")}
          </span>
        </div>

        <div className="rounded-2xl border-2 border-[#3d3428] bg-[#14110d] p-4 shadow-[inset_0_0_48px_rgba(0,0,0,0.5)]">
          <p className="mb-2 text-center text-xs font-semibold tracking-wide text-[var(--muted)]">
            {players.find((p) => p.seat === oppSeat)?.user.username ?? "..."}
          </p>
          <div className="flex justify-center gap-3">
            {oppProvinces.map((razed, i) => (
              <Province
                key={i}
                ownerSeat={oppSeat}
                idx={i}
                clickable={canPlan && !alreadySubmitted && !razed}
                selected={attack?.target === i}
                razed={razed}
                label={`${t("province")} ${i + 1}`}
              />
            ))}
          </div>

          <div className="my-3 text-center text-sm font-bold text-[var(--accent)]">
            {t("round")} {state?.round ?? 1}/5
          </div>

          <div className="flex justify-center gap-3">
            {myProvinces.map((razed, i) => (
              <Province
                key={i}
                ownerSeat={mySeat ?? 0}
                idx={i}
                clickable={canPlan && !alreadySubmitted && !razed}
                selected={defense?.target === i}
                razed={razed}
                label={`${t("province")} ${i + 1}`}
              />
            ))}
          </div>
          <p className="mt-2 text-center text-xs font-semibold">
            {players.find((p) => p.seat === mySeat)?.user.username ?? "..."}
            <em className="muted ms-1 font-normal">{t("youMarker")}</em>
          </p>
        </div>

        <p className="muted text-center text-sm">
          {conn === "closed"
            ? tg("disconnected")
            : conn === "connecting"
              ? tg("connecting")
            : state?.result
              ? ""
              : alreadySubmitted
                ? t("waitingOpponent")
                : canPlan
                  ? t("planHint")
                  : tg("waiting")}
        </p>
        </>
        )}
      </div>

      {/* Side panel */}
      <div className="flex flex-col gap-4">
        <VoicePanel
          gameId={gameId}
          selfName={user?.username}
          defaultCollapsed
          labels={{ join: tv("join"), leave: tv("leave"), mute: tv("mute"), unmute: tv("unmute"), title: tv("title"), micError: tv("micError") }}
        />


        <ChatPanel
          socket={socket}
          selfName={user?.username}
          room={room}
          title={tc("title")}
          placeholder={tc("placeholder")}
          sendLabel={tc("send")}
        />
        {!waiting && (
        <div className="card p-4">
          <h3 className="mb-2 font-semibold">⚔ {t("title")}</h3>
          <div className="flex flex-col gap-3 text-sm">
            <div>
              <p className="mb-1 font-semibold">⚔ {t("yourAttack")}</p>
              <div className="flex items-center gap-2">
                <span className="muted w-20">{t("province")}</span>
                {attack && <span className="font-bold">{attack.target + 1}</span>}
              </div>
              <div className="mt-1 flex items-center gap-1">
                <span className="muted w-20">{t("strength")}</span>
                {TOKENS.map((v) => (
                  <button
                    key={v}
                    disabled={!canPlan || alreadySubmitted || defense?.token === v}
                    onClick={() => setAttack((a) => ({ target: a?.target ?? 0, token: v }))}
                    className={`h-9 w-9 rounded-full border text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
                      attack?.token === v
                        ? "border-[var(--accent)] bg-[var(--accent)] font-bold text-black"
                        : "border-[#5a4a32] bg-[#1a1610]"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 font-semibold">🛡 {t("yourDefense")}</p>
              <div className="flex items-center gap-2">
                <span className="muted w-20">{t("province")}</span>
                {defense && <span className="font-bold">{defense.target + 1}</span>}
              </div>
              <div className="mt-1 flex items-center gap-1">
                <span className="muted w-20">{t("strength")}</span>
                {TOKENS.map((v) => (
                  <button
                    key={v}
                    disabled={!canPlan || alreadySubmitted || attack?.token === v}
                    onClick={() => setDefense((d) => ({ target: d?.target ?? 0, token: v }))}
                    className={`h-9 w-9 rounded-full border text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
                      defense?.token === v
                        ? "border-[var(--accent)] bg-[var(--accent)] font-bold text-black"
                        : "border-[#5a4a32] bg-[#1a1610]"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            {canPlan && !alreadySubmitted && (
              <button className="btn btn-primary" onClick={submitPlan}>
                🗡 {t("submitPlan")}
              </button>
            )}
            {alreadySubmitted && state?.phase === "choose" && (
              <p className="muted text-sm">✅ {t("waitingOpponent")}</p>
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>
        </div>
        )}

        {state && state.log.length > 0 && (
          <div className="card max-h-72 overflow-auto p-4">
            <h3 className="mb-2 font-semibold">{t("battleLog")}</h3>
            {state.log
              .slice()
              .reverse()
              .map((entry) => (
                <div key={entry.round} className="mb-2 border-b border-[var(--border)] pb-2 text-sm">
                  <div className="font-semibold">
                    {t("round")} {entry.round}
                  </div>
                  {entry.outcomes.map((o) => (
                    <div key={o.attacker} className="muted">
                      {o.attacker === mySeat ? t("you") : t("opponentName")} →{" "}
                      {t("province")} {o.target + 1}: {o.attack} vs {o.defense ?? "—"}{" "}
                      {o.razed ? "💥" : "🛡"}
                    </div>
                  ))}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
