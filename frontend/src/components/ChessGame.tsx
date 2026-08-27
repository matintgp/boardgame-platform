"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ensureSession, type SessionUser } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";
import { GameSocket, type Envelope } from "@/lib/gameSocket";
import ChatPanel from "@/components/ChatPanel";
import VoicePanel from "@/components/VoicePanel";
import {
  playCaptureSound,
  playCheckSound,
  playGameEndSound,
  playMoveSound,
} from "@/lib/sounds";

const FILES = "abcdefgh";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

function pieceImg(piece: string): string {
  // Files on disk are lowercase (wp.png, bk.png, ...) and the Linux container
  // filesystem is case-sensitive.
  const isWhite = piece === piece.toUpperCase();
  return `/pieces/${isWhite ? "w" : "b"}${piece.toLowerCase()}.png`;
}

interface ChessState {
  fen: string;
  san_history: string[];
  turn_seat: number;
  legal_moves: string[] | null;
  check_square?: string;
  clocks?: Record<string, number>;
  turn_started_at?: number | null;
  paused?: { seat: number; since: number } | null;
  result?: { reason: string; winner_seat: number | null };
}

interface LastMove {
  from: string;
  to: string;
  uci: string;
  san: string;
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
  created_by: string;
  players: PlayerInfo[];
  your_seat: number | null;
  is_host?: boolean;
}

function parseFen(fen: string): string[][] {
  // returns rows[rankIndex][fileIndex], rankIndex 0 = rank 8
  return fen.split(" ")[0].split("/").map((row) => {
    const cells: string[] = [];
    for (const ch of row) {
      if (/\d/.test(ch)) cells.push(...Array(Number(ch)).fill(""));
      else cells.push(ch);
    }
    return cells;
  });
}

function squareName(rankIdx: number, fileIdx: number, flip: boolean): string {
  const file = FILES[flip ? 7 - fileIdx : fileIdx];
  const rank = flip ? rankIdx + 1 : 8 - rankIdx;
  return `${file}${rank}`;
}

export default function GamePage({ gameId }: { gameId: string }) {
  const t = useTranslations("game");
  const router = useRouter();
  const tc = useTranslations("chat");
  const tv = useTranslations("voice");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [view, setView] = useState<GameView | null>(null);
  const [state, setState] = useState<ChessState | null>(null);
  const [conn, setConn] = useState<"connecting" | "open" | "closed">("connecting");
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingPromo, setPendingPromo] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<LastMove | null>(null);
  const [moveSeq, setMoveSeq] = useState(0);
  const [resultDismissed, setResultDismissed] = useState(false);
  const [rematchOffer, setRematchOffer] = useState<{ game_id: string; by: string } | null>(null);
  const socketRef = useRef<GameSocket | null>(null);
  const [socket, setSocket] = useState<GameSocket | null>(null);
  const seatFetchRef = useRef(false);
  const hydratedRef = useRef(false); // no sounds/animation for the initial snapshot
  const lastSoundSeqRef = useRef(0);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const mySeatRef = useRef<number | null | undefined>(undefined);
  const room = `game:${gameId}`;

  const players = view?.players ?? [];
  const status = state ? "active" : (view?.status ?? "waiting");
  const mySeat = view?.your_seat ?? undefined;
  const isHost = view?.is_host ?? false;
  mySeatRef.current = mySeat;

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
          // Broadcasts (e.g. someone joining) carry no personalized your_seat.
          // If we still don't know our seat (page opened before joining),
          // fetch the personalized view once.
          if (merged.your_seat == null && !seatFetchRef.current) {
            seatFetchRef.current = true;
            api<GameView>(`/api/games/${gameId}`)
              .then((g) => setView(g))
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
          state?: ChessState;
          events?: { type: string; payload?: { san?: string; uci?: string } }[];
        };
        if (payload.players) {
          setView((prev) => (prev ? { ...prev, players: payload.players! } : prev));
        }
        if (payload.state) {
          // Sounds + animation only for LIVE moves (seq newer than what we've
          // heard), never for the initial snapshot or reconnect replays.
          const seq = env.seq ?? 0;
          const isLive = hydratedRef.current && seq > lastSoundSeqRef.current;
          if (seq > lastSoundSeqRef.current) lastSoundSeqRef.current = seq;

          let move: LastMove | null = null;
          const mv = payload.events?.find((e) => e.type === "move_made");
          if (mv?.payload?.uci && mv.payload.san) {
            move = {
              from: mv.payload.uci.slice(0, 2),
              to: mv.payload.uci.slice(2, 4),
              uci: mv.payload.uci,
              san: mv.payload.san,
            };
          }

          if (isLive) {
            const over = payload.events?.some((e) => e.type === "game_over");
            if (over) {
              playGameEndSound();
            } else if (move) {
              const actorSeat = (mv as { seat?: number } | undefined)?.seat;
              const isOwn = actorSeat != null && actorSeat === mySeatRef.current;
              if (move.san.includes("+")) playCheckSound();
              else if (move.san.includes("x")) playCaptureSound();
              else playMoveSound(isOwn);
            }
            if (move) {
              setLastMove(move);
              setMoveSeq((n) => n + 1);
            }
          }
          setState(payload.state);
          hydratedRef.current = true;
        }
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
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

      // Current game info over REST (works even before WS connects).
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

  // If we're viewing a waiting lobby we're not (yet) a member of - e.g. we
  // opened a shared link before joining - poll until membership appears,
  // then subscribe to the room so live updates flow.
  useEffect(() => {
    if (!view || view.your_seat != null || view.status !== "waiting") return;
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      if (attempts > 60) {
        clearInterval(timer);
        return;
      }
      try {
        const g = await api<GameView>(`/api/games/${gameId}`);
        setView(g);
        if (g.your_seat != null) {
          clearInterval(timer);
          socketRef.current?.join(room);
        }
      } catch {
        clearInterval(timer);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [view?.your_seat, view?.status, gameId, room]);

  async function start() {
    setError(null);
    try {
      await api(`/api/games/${gameId}/start`, { method: "POST" });
      // The started envelope arrives via WS; refresh view as fallback.
      setView((prev) => (prev ? { ...prev, status: "active" } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    }
  }

  async function joinTable() {
    setError(null);
    try {
      await api(`/api/games/${gameId}/join`, { method: "POST" });
      // Now a member: fetch personalized view (your_seat) and subscribe to the room.
      const g = await api<GameView>(`/api/games/${gameId}`);
      setView(g);
      socketRef.current?.join(room);
    } catch (e) {
      setError(e instanceof Error ? e.message : "join failed");
    }
  }

  function onSquareClick(name: string) {
    setError(null);
    if (!state || !socketRef.current || mySeat === undefined) return;
    if (mySeat !== state.turn_seat || state.result || !state.legal_moves) return;

    if (selected) {
      // A pawn reaching the last rank has FOUR legal moves (q/r/b/n promotions),
      // all sharing from+to - so match by prefix, not exact equality.
      const candidates = state.legal_moves.filter((m) =>
        m.startsWith(`${selected}${name}`)
      );
      if (candidates.length > 0) {
        if (candidates[0].length === 4) {
          socketRef.current.sendMove(room, candidates[0]);
        } else {
          setPendingPromo({ from: selected, to: name });
        }
      }
      setSelected(null);
      return;
    }

    const hasMove = state.legal_moves.some((m) => m.startsWith(name));
    if (hasMove) setSelected(name);
  }

  // live clock re-render (1s tick while the game is running)
  const [, setClockTick] = useState(0);
  const gameLive = state != null && state.result == null;
  useEffect(() => {
    if (!gameLive) return;
    const i = setInterval(() => setClockTick((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, [gameLive]);

  function displayClock(seat: number): number {
    const base = state?.clocks?.[String(seat)] ?? 600;
    if (!state || state.result) return base;
    const active = state.turn_seat === seat && !state.paused;
    const elapsed =
      active && state.turn_started_at ? Date.now() / 1000 - state.turn_started_at : 0;
    return Math.max(0, base - elapsed);
  }

  function fmtClock(seat: number): string {
    const s = Math.ceil(displayClock(seat));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  const flip = mySeat === 1;
  const oppSeat = mySeat === 0 ? 1 : 0;
  const rows = parseFen(state?.fen ?? START_FEN);
  // Flip = reverse rank AND file order so the viewer's pieces sit at the bottom.
  const displayRows: string[][] = flip
    ? rows.slice().reverse().map((r) => r.slice().reverse())
    : rows;

  // Pixel offset for the slide-in animation of the last moved piece.
  const squareSize = boardRef.current?.clientWidth
    ? boardRef.current.clientWidth / 8
    : 60;
  const visualPos = (sq: string) => {
    const f = sq.charCodeAt(0) - 97;
    const r = Number(sq[1]);
    return {
      col: flip ? 7 - f : f,
      row: flip ? r - 1 : 8 - r,
    };
  };
  let animStyle: React.CSSProperties | undefined;
  if (lastMove && squareSize > 0) {
    const from = visualPos(lastMove.from);
    const to = visualPos(lastMove.to);
    animStyle = {
      ["--dx" as string]: `${(from.col - to.col) * squareSize}px`,
      ["--dy" as string]: `${(from.row - to.row) * squareSize}px`,
      animation: "piece-slide 160ms ease-out",
      zIndex: 5,
      position: "relative",
    };
  }

  const canStart = isHost && status === "waiting" && players.length >= 2;

  async function rematch() {
    try {
      const res = await api<{ game_id: string }>(`/api/games/${gameId}/rematch`, {
        method: "POST",
      });
      router.push(`/game/${res.game_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "rematch failed");
    }
  }

  const result = state?.result ?? null;
  const showResult = result != null && !resultDismissed;
  const winnerName =
    result?.winner_seat != null
      ? (players.find((p) => p.seat === result.winner_seat)?.user.username ?? "?")
      : null;
  const iWon = result?.winner_seat != null && result.winner_seat === mySeat;
  const isCheckmate = result?.reason === "checkmate";

  const myRatingDelta = useMemo(() => {
    if (!result || mySeat == null) return null;
    const r = (result as { ratings?: Record<string, { delta: number }> }).ratings;
    return r?.[String(mySeat)]?.delta ?? null;
  }, [result, mySeat]);

  const confetti = useMemo(
    () =>
      Array.from({ length: 42 }, (_, i) => ({
        left: (i * 37) % 100,
        delay: (i % 12) * 0.14,
        duration: 2.2 + ((i * 7) % 10) / 8,
        color: ["#f7b32b", "#e5533d", "#4d9de0", "#7bc96f", "#c77dff"][i % 5],
        w: 6 + (i % 4) * 2,
      })),
    []
  );

  async function newGame() {
    try {
      const g = await api<{ id: string }>("/api/games", {
        method: "POST",
        body: JSON.stringify({ game_type: "chess" }),
      });
      router.push(`/game/${g.id}`);
    } catch {
      router.push("/lobby");
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr]">
      {/* Rematch offer from the opponent */}
      {rematchOffer && (
        <div className="card mb-4 flex items-center justify-between border-[var(--accent)] p-4">
          <span>
            🔁 <span className="font-bold">{rematchOffer.by}</span> {t("rematchOffer")}
          </span>
          <button
            className="btn btn-primary"
            onClick={() =>
              router.push(`/game/${rematchOffer.game_id}`)
            }
          >
            {t("accept")}
          </button>
        </div>
      )}
      {/* Result overlay (chess.com style) */}
      {showResult && result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="result-pop card relative w-full max-w-sm overflow-hidden p-6 text-center">
            {iWon && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                {confetti.map((c, i) => (
                  <span
                    key={i}
                    className="confetti-piece"
                    style={{
                      left: `${c.left}%`,
                      width: c.w,
                      background: c.color,
                      animationDelay: `${c.delay}s`,
                      animationDuration: `${c.duration}s`,
                    }}
                  />
                ))}
              </div>
            )}
            <div className="trophy-glow mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--surface)] text-4xl"
                 style={{ border: "1px solid var(--border)" }}>
              {result.winner_seat == null ? "🤝" : "🏆"}
            </div>
            <h2 className="text-2xl font-extrabold text-[var(--accent)]">
              {isCheckmate
                ? t("checkmate")
                : result.reason === "stalemate"
                  ? t("stalemateTitle")
                  : result.reason === "timeout"
                    ? t("timeoutTitle")
                    : result.reason === "abandoned"
                      ? t("abandonedTitle")
                      : t("draw")}
            </h2>
            <p className="mt-2 text-sm">
              {result.winner_seat == null ? (
                t("drawReason")
              ) : iWon ? (
                <span className="font-bold text-[var(--accent)]">
                  {isCheckmate ? t("youWonBy") : t("winGeneric")}
                </span>
              ) : (
                <>
                  <span className="font-bold">{winnerName}</span>{" "}
                  {isCheckmate ? t("wonByCheckmate") : t("opponentWonGeneric")}
                  <span className="muted block mt-1">{t("youLostBy")}</span>
                </>
              )}
            </p>
            {myRatingDelta != null && (
              <p
                className={`mt-1 text-lg font-bold ${
                  myRatingDelta >= 0 ? "text-green-400" : "text-red-400"
                }`}
              >
                {myRatingDelta >= 0 ? "+" : ""}
                {myRatingDelta} {t("rating")}
              </p>
            )}
            <div className="mt-5 flex justify-center gap-3">
              <button className="btn btn-primary" onClick={rematch}>🔁 {t("rematch")}</button>
              <button className="btn btn-ghost" onClick={() => setResultDismissed(true)}>
                {t("reviewBoard")}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Promotion picker */}
      {pendingPromo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
             onClick={() => setPendingPromo(null)}>
          <div className="card p-4" onClick={(e) => e.stopPropagation()}>
            <p className="mb-2 text-center text-sm font-semibold">{t("promoteTo")}</p>
            <div className="flex gap-2">
              {["q", "r", "n", "b"].map((p) => (
                <button
                  key={p}
                  aria-label={`promote-${p}`}
                  className="btn btn-ghost !p-2"
                  onClick={() => {
                    socketRef.current?.sendMove(
                      room, `${pendingPromo.from}${pendingPromo.to}${p}`
                    );
                    setPendingPromo(null);
                  }}
                >
                  <img
                    src={`/pieces/${mySeat === 1 ? "b" : "w"}${p}.png`}
                    alt={p}
                    draggable={false}
                    className="h-14 w-14"
                  />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* Board */}
      <div className="mx-auto">
        {state && (
          <div className="mx-auto mb-1 flex w-[min(88vw,480px)] justify-between text-sm">
            {[oppSeat, mySeat ?? 0].map((seat) => {
              const secs = displayClock(seat);
              const isActive = state.turn_seat === seat && !state.result;
              const low = secs < 30;
              return (
                <div
                  key={seat}
                  className={`card px-3 py-1 font-mono ${
                    isActive ? "border-[var(--accent)]" : ""
                  } ${low ? "text-red-400" : ""}`}
                >
                  {players.find((p) => p.seat === seat)?.user.username.slice(0, 12) ?? "?"}{" "}
                  <span className="font-bold">{fmtClock(seat)}</span>
                </div>
              );
            })}
          </div>
        )}
        {state?.paused && state.paused.seat !== mySeat && (
          <div className="card mb-2 border-yellow-600 p-2 text-center text-sm text-yellow-400">
            ⏳ {t("opponentOffline")}{" "}
            {Math.max(0, Math.ceil(60 - (Date.now() / 1000 - state.paused.since)))}s
          </div>
        )}
        {state?.paused && state.paused.seat === mySeat && (
          <div className="card mb-2 border-yellow-600 p-2 text-center text-sm text-yellow-400">
            ⏳ {t("reconnecting")}
          </div>
        )}
        {state &&
          !state.result &&
          !state.paused &&
          mySeat === state.turn_seat &&
          state.turn_started_at &&
          Date.now() / 1000 - state.turn_started_at > 30 && (
            <div className="card mb-2 border-orange-600 p-2 text-center text-sm text-orange-400">
              ⚠ {t("autoMoveIn", { seconds: Math.ceil(60 - (Date.now() / 1000 - state.turn_started_at)) })}
            </div>
          )}
        <div
          ref={boardRef}
          className="grid aspect-square w-[min(88vw,480px)] overflow-hidden rounded-lg border border-[var(--border)] select-none"
          style={{
            gridTemplateColumns: "repeat(8, 1fr)",
            gridTemplateRows: "repeat(8, 1fr)",
          }}
          dir="ltr"
        >
          {displayRows.map((row, ri) =>
            row.map((piece, fi) => {
              const name = squareName(ri, fi, flip);
              const light = (ri + fi) % 2 === 0;
              const isSelected = selected === name;
              const isTarget =
                selected != null &&
                state?.legal_moves?.some((m) => m.startsWith(`${selected}${name}`));
              const isLastMove =
                lastMove && (name === lastMove.from || name === lastMove.to);
              const inCheckHere = state?.check_square === name;
              return (
                <button
                  key={name}
                  aria-label={name}
                  onClick={() => onSquareClick(name)}
                  className={`relative flex items-center justify-center ${
                    light ? "bg-[#ebecd0]" : "bg-[#739552]"
                  } ${isSelected ? "outline outline-2 -outline-offset-2 outline-[var(--accent)]" : ""}`}
                >
                  {isLastMove && (
                    <span className="absolute inset-0 bg-[#f6f669]/55" />
                  )}
                  {inCheckHere && (
                    <span
                      className="absolute inset-0"
                      style={{
                        background:
                          "radial-gradient(circle, rgba(255,70,50,.95) 15%, rgba(255,70,50,.55) 55%, transparent 75%)",
                      }}
                    />
                  )}
                  {isTarget && (
                    <span className="absolute h-3 w-3 rounded-full bg-black/30" />
                  )}
                  {piece && (
                    <img
                      key={`${name}-${moveSeq}`}
                      src={pieceImg(piece)}
                      alt=""
                      draggable={false}
                      className="pointer-events-none relative z-[1] h-[88%] w-[88%]"
                      style={
                        lastMove && name === lastMove.to ? animStyle : undefined
                      }
                    />
                  )}
                </button>
              );
            })
          )}
        </div>
        <p className="muted mt-2 text-center text-sm">
          {conn === "closed"
            ? t("disconnected")
            : conn === "connecting"
              ? t("connecting")
            : !state
              ? status === "waiting"
                ? t("waiting")
                : "..."
              : state.result
                ? formatResult(state.result, mySeat, t)
                : mySeat === state.turn_seat
                  ? t("yourTurn")
                  : t("opponentTurn")}
        </p>
      </div>

      {/* Side panel */}
      <div className="flex flex-col gap-4">
        <div className="card p-4">
          <h3 className="mb-2 font-semibold">♞ Chess</h3>
          {players.map((p) => {
            const isViewer = p.user.id === user?.id;
            return (
              <div key={p.seat} className="flex justify-between py-1 text-sm">
                <span>
                  {p.seat === 0 ? "♔" : "♚"} {p.user.username}
                  {isViewer && <em className="muted ms-1">{t("youMarker")}</em>}
                </span>
                <span className="muted">
                  {p.seat === 0
                    ? isViewer ? t("youPlayWhite") : t("playsWhite")
                    : isViewer ? t("youPlayBlack") : t("playsBlack")}
                </span>
              </div>
            );
          })}
          {players.length < 2 && (
            <p className="muted mt-2 text-sm">
              ⏳ {t("waiting")} ({players.length}/{view?.max_players ?? 2})
            </p>
          )}
          {view && mySeat == null && view.status === "waiting" && (
            <button className="btn btn-primary mt-3 w-full" onClick={joinTable}>
              {t("join")}
            </button>
          )}
          {canStart && (
            <button className="btn btn-primary mt-3 w-full" onClick={start}>
              ▶ {t("start")}
            </button>
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

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

        {state && (
          <div className="card max-h-64 overflow-auto p-4">
            <h3 className="mb-2 font-semibold">{t("moves")}</h3>
            <div className="grid grid-cols-2 gap-x-4 text-sm">
              {state.san_history.map((san, i) => (
                <span key={i}>
                  {Math.floor(i / 2) + 1}
                  {i % 2 === 0 ? "." : "..."} {san}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function formatResult(
  result: { reason: string; winner_seat: number | null },
  mySeat: number | undefined,
  t: (key: string) => string
): string {
  if (result.winner_seat == null) return t(result.reason === "stalemate" ? "stalemate" : "draw");
  if (result.winner_seat === mySeat) return t("youWin");
  if (mySeat == null) return result.winner_seat === 0 ? t("whiteWins") : t("blackWins");
  return t("youLose");
}

