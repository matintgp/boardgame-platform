"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ensureSession, type SessionUser } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";
import { GameSocket, type Envelope } from "@/lib/gameSocket";
import ChatPanel from "@/components/ChatPanel";
import VoicePanel from "@/components/VoicePanel";
import LobbyExpiryNote, { lobbyTimedOut } from "@/components/LobbyExpiryNote";
import { joinRematchTable } from "@/lib/rematch";
import {
  playCaptureSound,
  playGameEndSound,
  playMoveSound,
} from "@/lib/sounds";
import "@/styles/rokugan.css";
import { playRokuganLock, playRokuganRaze, playRokuganToken } from "@/components/rokugan/rokuganSounds";

interface RokuganState {
  round: number;
  phase: "choose" | "over";
  provinces: Record<string, boolean[]>;
  log: {
    round: number;
    outcomes: {
      attacker: number;
      target: number;
      attack: number;
      defended: boolean;
      defense: number | null;
      razed: boolean;
    }[];
  }[];
  result: { reason: string; winner_seat: number | null } | null;
  you: {
    seat: number;
    plan: {
      attack: { target: number; token: number };
      defense: { target: number; token: number };
    } | null;
  } | null;
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
  const [rematchOffer, setRematchOffer] = useState<{ game_id: string; by: string } | null>(null);
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
      if (env.type === "rematch") {
        const p = env.payload as { game_id: string; by: string };
        setRematchOffer(p);
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
            else if (reveal) {
              const last = payload.state.log?.at(-1);
              if (last?.outcomes?.some((o) => o.razed)) playRokuganRaze();
              else playCaptureSound();
            } else playMoveSound(true);
          }
          // Clear local draft when the server opens a new choose window (round advance).
          const next = payload.state;
          const sealed = next.you?.plan != null;
          if (!sealed && next.phase === "choose") {
            setAttack(null);
            setDefense(null);
          }
          setState(next);
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
  }, [applyEnvelope, gameId, room, router]);

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
      playRokuganLock();
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
    role,
    razed,
    label,
  }: {
    ownerSeat: number;
    idx: number;
    clickable: boolean;
    selected: boolean;
    role: "attack" | "defense" | null;
    razed: boolean;
    label: string;
  }) {
    const roleClass =
      selected && role === "attack"
        ? "is-attack-target"
        : selected && role === "defense"
          ? "is-defense-target"
          : "";
    return (
      <button
        type="button"
        disabled={!clickable}
        aria-pressed={selected}
        aria-label={label}
        onClick={() => {
          if (ownerSeat === oppSeat) {
            setAttack((a) => ({ target: idx, token: a?.token ?? 3 }));
          } else {
            setDefense((d) => ({ target: idx, token: d?.token ?? 3 }));
          }
        }}
        className={`rk-province ${razed ? "is-razed" : ""} ${selected ? "is-picked" : ""} ${roleClass} ${clickable ? "is-live" : ""}`}
      >
        {selected && role && (
          <span className={`rk-province-badge is-${role}`} aria-hidden>
            {role === "attack" ? t("attackShort") : t("defenseShort")}
          </span>
        )}
        <img src={razed ? "/rokugan/icons/ash.svg" : "/rokugan/icons/shrine.svg"} alt="" />
        <span className="rk-province-label">{label}</span>
      </button>
    );
  }

  const myProvinces = state?.provinces?.[String(mySeat ?? 0)] ?? [false, false, false];
  const oppProvinces = state?.provinces?.[String(oppSeat ?? 1)] ?? [false, false, false];
  const canPlan = state?.phase === "choose" && mySeat != null && conn === "open";
  const alreadySubmitted = state?.you?.plan != null;
  const sealedPlan = state?.you?.plan ?? null;
  const displayAttack = alreadySubmitted ? sealedPlan?.attack ?? null : attack;
  const displayDefense = alreadySubmitted ? sealedPlan?.defense ?? null : defense;
  const waiting = (view?.status ?? "waiting") === "waiting" || !state || players.length < 2;
  const timedOut = lobbyTimedOut(view?.status, view?.expires_at, view?.created_at);
  const maxPlayers = view?.max_players ?? 2;
  const canStart = (view?.is_host ?? false) && waiting && players.length >= maxPlayers && !timedOut;
  const oppReady = !!state?.opponent?.submitted;
  const oppName = players.find((p) => p.seat === oppSeat)?.user.username ?? "...";
  const myName = players.find((p) => p.seat === mySeat)?.user.username ?? "...";

  let statusHint = tg("waiting");
  if (conn === "closed") statusHint = tg("disconnected");
  else if (conn === "connecting") statusHint = tg("connecting");
  else if (state?.result) statusHint = "";
  else if (alreadySubmitted) statusHint = t("waitingOpponent");
  else if (canPlan) statusHint = t("planHint");

  return (
    <div className="rk-root grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr]">
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
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    const res = await api<{ game_id: string }>(`/api/games/${gameId}/rematch`, {
                      method: "POST",
                    });
                    router.push(`/game/${res.game_id}`);
                  } catch {
                    router.push("/lobby");
                  }
                }}
              >
                🔁 {tg("rematch")}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setResultDismissed(true)}>
                {tg("reviewBoard")}
              </button>
            </div>
          </div>
        </div>
      )}

      {rematchOffer && (
        <div className="card mb-4 flex w-full max-w-md items-center justify-between gap-3 border-[var(--accent)] p-4">
          <span>
            🔁 <span className="font-bold">{rematchOffer.by}</span> {tg("rematchOffer")}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              try {
                await joinRematchTable(rematchOffer.game_id);
                router.push(`/game/${rematchOffer.game_id}`);
              } catch (e) {
                setError(e instanceof Error ? e.message : "join failed");
              }
            }}
          >
            {tg("accept")}
          </button>
        </div>
      )}

      <div className="rk-stage mx-auto">
        {waiting ? (
          <div className="rk-lobby">
            <div className="rk-lobby-hero">
              <img src="/heroes/rokugan.jpg" alt="" />
              <div className="rk-lobby-shade" />
              <div className="rk-lobby-hero-copy">
                <p className="rk-lobby-kicker">{t("lobbyKicker")}</p>
                <h2>{t("title")}</h2>
                <p className="mt-1 text-sm text-[var(--rk-paper-dim)]">{t("lobbySubtitle")}</p>
              </div>
            </div>
            <div className="rk-lobby-body">
              <p className="rk-lobby-wait">
                {tg("waiting")} ({players.length}/{maxPlayers})
              </p>
              <LobbyExpiryNote
                expiresAt={view?.expires_at}
                createdAt={view?.created_at}
                status={view?.status}
                expiredLabel={tl("expired")}
                expiresIn={(p) => tl("expiresIn", p)}
              />
              <p className="mt-3 text-xs font-semibold tracking-wide text-[var(--rk-gold)]">
                {t("playersSeated")}
              </p>
              <div className="rk-seat-list">
                {players.map((p) => (
                  <div key={p.seat} className={`rk-seat ${p.user.id === user?.id ? "is-you" : ""}`}>
                    <span>
                      {p.user.username}
                      {p.user.id === user?.id && <em className="muted ms-1">{t("youMarker")}</em>}
                    </span>
                  </div>
                ))}
              </div>
              {view && mySeat == null && !timedOut && (
                <button type="button" className="btn btn-primary mt-4 w-full" onClick={joinTable}>
                  {tg("join")}
                </button>
              )}
              {canStart && (
                <button type="button" className="btn btn-primary mt-4 w-full" onClick={start}>
                  ▶ {tg("start")}
                </button>
              )}
              {error && <p className="rk-error">{error}</p>}
            </div>
          </div>
        ) : (
          <>
            <div className="rk-banner">
              <span className="flex items-center gap-2 font-bold">
                <img className="rk-crest" src="/rokugan/icons/crest.svg" alt="" />
                {oppName}
              </span>
              <span className={`rk-status-chip ${oppReady ? "is-ready" : "is-waiting"}`}>
                <span className="rk-status-dot" aria-hidden />
                {oppReady ? t("opponentReady") : t("opponentThinking")}
              </span>
            </div>

            <div className="rk-table">
              <p className="rk-side-label mb-2">{oppName}</p>
              <div className="rk-row">
                {oppProvinces.map((razed, i) => (
                  <Province
                    key={`opp-${i}`}
                    ownerSeat={oppSeat}
                    idx={i}
                    clickable={canPlan && !alreadySubmitted && !razed}
                    selected={displayAttack?.target === i}
                    role={displayAttack?.target === i ? "attack" : null}
                    razed={razed}
                    label={`${t("province")} ${i + 1}`}
                  />
                ))}
              </div>

              <div className="rk-river">
                {t("round")} {state?.round ?? 1}/5
              </div>

              <div className="rk-row">
                {myProvinces.map((razed, i) => (
                  <Province
                    key={`me-${i}`}
                    ownerSeat={mySeat ?? 0}
                    idx={i}
                    clickable={canPlan && !alreadySubmitted && !razed}
                    selected={displayDefense?.target === i}
                    role={displayDefense?.target === i ? "defense" : null}
                    razed={razed}
                    label={`${t("province")} ${i + 1}`}
                  />
                ))}
              </div>
              <p className="rk-side-label is-self mt-2">
                {myName}
                <em className="muted ms-1 font-normal">{t("youMarker")}</em>
              </p>
            </div>

            {statusHint && (
              <p className={`rk-hint ${alreadySubmitted ? "is-sealed" : ""}`} aria-live="polite">
                {statusHint}
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex flex-col gap-4">
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
          title={tc("title")}
          placeholder={tc("placeholder")}
          sendLabel={tc("send")}
        />

        {!waiting && (
          <div className="rk-panel">
            <div className="rk-panel-head">
              <h3>{t("title")}</h3>
              <span
                className={`rk-status-chip ${alreadySubmitted ? "is-ready" : "is-waiting"}`}
              >
                <span className="rk-status-dot" aria-hidden />
                {alreadySubmitted ? t("planSealed") : t("draftPlan")}
              </span>
            </div>
            <div className="rk-panel-body">
              <div className={`rk-plan-block is-attack ${alreadySubmitted ? "is-sealed" : ""}`}>
                <div className="rk-plan-title">
                  <span>{t("yourAttack")}</span>
                  <span className="rk-province-badge is-attack">{t("attackShort")}</span>
                </div>
                <div className="rk-plan-meta">
                  <span className="muted">{t("targetProvince")}</span>
                  {displayAttack ? (
                    <span className="rk-plan-value">{displayAttack.target + 1}</span>
                  ) : (
                    <span className="rk-plan-value is-empty">{t("pickProvince")}</span>
                  )}
                </div>
                <div className="rk-plan-meta">
                  <span className="muted">{t("strength")}</span>
                </div>
                <div className="rk-token-row" role="group" aria-label={t("yourAttack")}>
                  {TOKENS.map((v) => {
                    const locked = !alreadySubmitted && defense?.token === v;
                    const picked = displayAttack?.token === v;
                    return (
                      <button
                        type="button"
                        key={`atk-${v}`}
                        disabled={!canPlan || alreadySubmitted || locked}
                        title={locked ? t("tokenInUse") : undefined}
                        aria-pressed={picked}
                        onClick={() => {
                          playRokuganToken();
                          setAttack((a) => ({ target: a?.target ?? 0, token: v }));
                        }}
                        className={`rk-token ${picked ? "is-picked is-attack" : ""} ${locked ? "is-locked" : ""}`}
                      >
                        {v}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={`rk-plan-block is-defense ${alreadySubmitted ? "is-sealed" : ""}`}>
                <div className="rk-plan-title">
                  <span>{t("yourDefense")}</span>
                  <span className="rk-province-badge is-defense">{t("defenseShort")}</span>
                </div>
                <div className="rk-plan-meta">
                  <span className="muted">{t("targetProvince")}</span>
                  {displayDefense ? (
                    <span className="rk-plan-value">{displayDefense.target + 1}</span>
                  ) : (
                    <span className="rk-plan-value is-empty">{t("pickProvince")}</span>
                  )}
                </div>
                <div className="rk-plan-meta">
                  <span className="muted">{t("strength")}</span>
                </div>
                <div className="rk-token-row" role="group" aria-label={t("yourDefense")}>
                  {TOKENS.map((v) => {
                    const locked = !alreadySubmitted && attack?.token === v;
                    const picked = displayDefense?.token === v;
                    return (
                      <button
                        type="button"
                        key={`def-${v}`}
                        disabled={!canPlan || alreadySubmitted || locked}
                        title={locked ? t("tokenInUse") : undefined}
                        aria-pressed={picked}
                        onClick={() => {
                          playRokuganToken();
                          setDefense((d) => ({ target: d?.target ?? 0, token: v }));
                        }}
                        className={`rk-token ${picked ? "is-picked is-defense" : ""} ${locked ? "is-locked" : ""}`}
                      >
                        {v}
                      </button>
                    );
                  })}
                </div>
              </div>

              {canPlan && !alreadySubmitted && (
                <button type="button" className="btn btn-primary rk-submit" onClick={submitPlan}>
                  {t("submitPlan")}
                </button>
              )}
              {alreadySubmitted && state?.phase === "choose" && (
                <div className="rk-seal-note" role="status">
                  <span aria-hidden>●</span>
                  <span>
                    {t("planSealed")}
                    {oppReady ? ` · ${t("readyStatus")}` : ` · ${t("waitingStatus")}`}
                  </span>
                </div>
              )}
              {error && <p className="rk-error">{error}</p>}
            </div>
          </div>
        )}

        {state && state.log.length > 0 && (
          <div className="rk-log">
            <h3>{t("battleLog")}</h3>
            {state.log
              .slice()
              .reverse()
              .map((entry) => (
                <div key={entry.round} className="rk-log-round">
                  <div className="rk-log-round-title">
                    {t("round")} {entry.round}
                  </div>
                  {entry.outcomes.map((o) => {
                    const who = o.attacker === mySeat ? t("you") : t("opponentName");
                    const defLabel =
                      o.defense == null ? t("noDefense") : String(o.defense);
                    return (
                      <div
                        key={`${entry.round}-${o.attacker}`}
                        className={`rk-outcome ${o.razed ? "is-razed" : "is-held"}`}
                      >
                        <div className="rk-outcome-who">
                          {who} → {t("province")} {o.target + 1}
                        </div>
                        <span
                          className={`rk-outcome-tag ${o.razed ? "is-razed" : "is-held"}`}
                        >
                          {o.razed ? t("outcomeRazed") : t("outcomeHeld")}
                        </span>
                        <div className="rk-outcome-line">
                          <span className="rk-outcome-vs">
                            {t("strengthVs", {
                              attack: o.attack,
                              defense: defLabel,
                            })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
