"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ensureSession, type SessionUser } from "@/lib/api";
import { Link, useRouter } from "@/i18n/navigation";
import {
  MAX_OPEN_LOBBIES,
  isTooManyLobbies,
  parseExpiryMs,
  remainingLobby,
} from "@/lib/lobbyExpiry";

interface LobbyInfo {
  id: string;
  game_type: string;
  status: string;
  max_players: number;
  created_by?: string;
  created_at?: string | number | null;
  expires_at?: string | number | null;
  players: { seat: number; user: { id: string; username: string } }[];
}
interface MyGame {
  id: string;
  game_type: string;
  status: string;
}

const MODES = [
  {
    id: "chess" as const,
    cover: "/heroes/chess.jpg",
    nameKey: "gameChess" as const,
    tagKey: "gameChessTag" as const,
    createKey: "createChess" as const,
  },
  {
    id: "mafia" as const,
    cover: "/heroes/mafia.jpg",
    nameKey: "gameMafia" as const,
    tagKey: "gameMafiaTag" as const,
    createKey: "createMafia" as const,
  },
  {
    id: "rokugan" as const,
    cover: "/heroes/rokugan.jpg",
    nameKey: "gameRokugan" as const,
    tagKey: "gameRokuganTag" as const,
    createKey: "createRokugan" as const,
  },
  {
    id: "salem" as const,
    cover: "/heroes/salem.jpg",
    nameKey: "gameSalem" as const,
    tagKey: "gameSalemTag" as const,
    createKey: "createSalem" as const,
  },
];

function gameLabel(
  t: ReturnType<typeof useTranslations>,
  gameType: string
): { name: string; cover: string } {
  switch (gameType) {
    case "mafia":
      return { name: t("gameMafia"), cover: "/heroes/mafia.jpg" };
    case "rokugan":
      return { name: t("gameRokugan"), cover: "/heroes/rokugan.jpg" };
    case "chess":
      return { name: t("gameChess"), cover: "/heroes/chess.jpg" };
    case "salem":
      return { name: t("gameSalem"), cover: "/heroes/salem.jpg" };
    default:
      return { name: t("unknownGame"), cover: "" };
  }
}

function statusPill(t: ReturnType<typeof useTranslations>, status: string) {
  const s = status.toLowerCase();
  if (s === "waiting" || s === "queued" || s === "open") {
    return { cls: "pill pill-wait", label: t("statusWaiting") };
  }
  if (s === "active" || s === "in_progress" || s === "playing" || s === "started") {
    return { cls: "pill pill-live", label: t("statusActive") };
  }
  if (s === "finished" || s === "completed" || s === "ended") {
    return { cls: "pill pill-done", label: t("statusFinished") };
  }
  if (s === "aborted" || s === "cancelled" || s === "expired") {
    return { cls: "pill pill-abort", label: t("statusAborted") };
  }
  return { cls: "pill pill-done", label: status };
}

export default function LobbyPage() {
  const t = useTranslations("lobby");
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [lobbies, setLobbies] = useState<LobbyInfo[]>([]);
  const [myGames, setMyGames] = useState<MyGame[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  type ModeId = "chess" | "mafia" | "rokugan" | "salem";
  const [searching, setSearching] = useState<ModeId | null>(null);
  const searchRef = useRef<ModeId | null>(null);

  const refreshLists = useCallback(async () => {
    setListError(null);
    try {
      const [ls, mine] = await Promise.all([
        api<LobbyInfo[]>("/api/games/lobbies"),
        api<MyGame[]>("/api/games/mine"),
      ]);
      setLobbies(ls);
      setMyGames(mine);
    } catch (e) {
      setListError(e instanceof Error ? e.message : t("loadError"));
    } finally {
      setListLoading(false);
    }
  }, [t]);

  useEffect(() => {
    ensureSession().then((u) => {
      if (!u) {
        router.replace("/login");
        return;
      }
      setUser(u);
      void refreshLists();
    });
  }, [router, refreshLists]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => void refreshLists(), 15000);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [refreshLists]);

  async function createTable(gameType: ModeId) {
    setBusy(gameType);
    setJoinError(null);
    const hosted = user
      ? lobbies.filter((l) => {
          if (l.created_by !== user.id || l.status !== "waiting") return false;
          return !remainingLobby(parseExpiryMs(l), Date.now())?.expired;
        }).length
      : 0;
    if (hosted >= MAX_OPEN_LOBBIES) {
      setJoinError(t("tooManyLobbies"));
      setBusy(null);
      return;
    }
    try {
      const g = await api<{ id: string }>("/api/games", {
        method: "POST",
        body: JSON.stringify({ game_type: gameType }),
      });
      router.push(`/game/${g.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("loadError");
      setJoinError(isTooManyLobbies(msg) ? t("tooManyLobbies") : msg);
    } finally {
      setBusy(null);
    }
  }

  async function join(id: string) {
    setJoinError(null);
    try {
      await api(`/api/games/${id}/join`, { method: "POST" });
      router.push(`/game/${id}`);
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : t("joinFailed"));
      void refreshLists();
    }
  }

  useEffect(() => {
    if (!searching) return;
    const gameType = searching;
    let stopped = false;
    const poll = async () => {
      while (!stopped && searchRef.current === gameType) {
        try {
          const res = await api<{ status: string; game_id?: string }>(
            "/api/games/queue",
            { method: "POST", body: JSON.stringify({ game_type: gameType }) }
          );
          if (res.status === "matched" && res.game_id) {
            searchRef.current = null;
            setSearching(null);
            router.push(`/game/${res.game_id}`);
            return;
          }
        } catch {
          searchRef.current = null;
          setSearching(null);
          return;
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
    };
    void poll();
    return () => {
      stopped = true;
    };
  }, [searching, router]);

  function quickMatch(gameType: ModeId) {
    searchRef.current = gameType;
    setSearching(gameType);
  }

  async function cancelSearch() {
    const gameType = searchRef.current;
    searchRef.current = null;
    setSearching(null);
    if (!gameType) return;
    await api(`/api/games/queue?game_type=${gameType}`, { method: "DELETE" }).catch(
      () => undefined
    );
  }

  const visibleLobbies = lobbies
    .map((l) => ({ l, clock: remainingLobby(parseExpiryMs(l), now) }))
    .filter(({ clock }) => !clock?.expired);
  const hostedCount = user
    ? visibleLobbies.filter(({ l }) => l.created_by === user.id && l.status === "waiting").length
    : 0;
  const atCap = hostedCount >= MAX_OPEN_LOBBIES;

  return (
    <div className="flex flex-col gap-8">
      <div className="enter flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">{t("kicker")}</p>
          <h1 className="type-h1 mt-1">{t("title")}</h1>
          <p className="muted mt-1 text-sm">{t("subtitle")}</p>
        </div>
        {user && (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`host-cap ${atCap ? "is-full" : ""}`}>
              {t("hostCap", { n: hostedCount, max: MAX_OPEN_LOBBIES })}
            </span>
            <span className="muted text-sm">
              {user.username} · {user.rating}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {MODES.map((m, i) => {
          const isSearching = searching === m.id;
          return (
            <article key={m.id} className={`card card-lift game-tile is-${m.id} overflow-hidden enter enter-d${i + 1}`}>
              <div className="game-cover h-28">
                <img src={m.cover} alt={t(m.nameKey)} loading="lazy" />
                <div className="cover-shade" />
                <div className="absolute inset-x-0 bottom-0 p-3 text-start">
                  <h2 className="font-bold">{t(m.nameKey)}</h2>
                </div>
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="muted text-sm">{t(m.tagKey)}</p>
                {isSearching ? (
                  <div className="mm-wrap flex-col gap-3 p-3" aria-live="polite">
                    <div className="flex items-center gap-3">
                      <div className="mm-orb" aria-hidden="true">
                        <span className="mm-ring" />
                        <span className="mm-ring delay" />
                        <span className="mm-orb-core" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold">{t("searching")}</div>
                        <p className="muted mt-0.5 text-xs">{t("matchmakingHint")}</p>
                      </div>
                    </div>
                    <button className="btn btn-ghost w-full" onClick={cancelSearch}>
                      {t("cancel")}
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      className="btn btn-primary"
                      onClick={() => quickMatch(m.id)}
                      disabled={searching !== null}
                    >
                      {t("quickMatch")}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => createTable(m.id)}
                      disabled={busy !== null || searching !== null || atCap}
                    >
                      {t(m.createKey)}
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {(joinError || atCap) && (
        <p className="lobby-alert" role="alert">
          {joinError || t("tooManyLobbies")}
        </p>
      )}

      <section className="enter enter-d4">
        <h2 className="mb-3 font-semibold">{t("openLobbies")}</h2>
        {listLoading && <p className="muted">{t("loading")}</p>}
        {listError && (
          <p className="text-sm text-red-400">
            {t("loadError")}{" "}
            <button className="btn btn-ghost !py-1 !px-2" onClick={() => void refreshLists()}>
              {t("retry")}
            </button>
          </p>
        )}
        {!listLoading && !listError && visibleLobbies.length === 0 && (
          <div className="card empty-state">
            <p>{t("empty")}</p>
          </div>
        )}
        <div className="enter-stagger flex flex-col gap-2">
          {visibleLobbies.map(({ l, clock }) => {
            const { name } = gameLabel(t, l.game_type);
            const pill = statusPill(t, l.status || "waiting");
            const pct = l.max_players
              ? Math.min(100, Math.round((l.players.length / l.max_players) * 100))
              : 0;
            return (
              <div key={l.id} className={`card card-lift table-row game-tile is-${l.game_type} flex flex-wrap items-center justify-between gap-3 p-4`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{name}</span>
                    <span className={pill.cls}>{pill.label}</span>
                    {clock && (
                      <span
                        className={`lobby-ttl ${clock.urgent ? "is-urgent" : ""} ${clock.expired ? "is-expired" : ""}`}
                      >
                        ⏳ {t("expiresIn", { time: clock.label })}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="seat-bar w-32 sm:w-44">
                      <span style={{ width: `${pct}%` }} />
                    </div>
                    <span className="muted text-sm">
                      {t("players")}: {l.players.length}/{l.max_players}
                    </span>
                  </div>
                </div>
                <button className="btn btn-primary" onClick={() => join(l.id)}>
                  {t("join")}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {myGames.length > 0 && (
        <section className="enter enter-d5">
          <h2 className="mb-3 font-semibold">{t("yourGames")}</h2>
          <div className="enter-stagger flex flex-col gap-2">
            {myGames.map((g) => {
              const { name } = gameLabel(t, g.game_type);
              const pill = statusPill(t, g.status);
              return (
                <Link
                  key={g.id}
                  href={`/game/${g.id}`}
                  className="card card-lift flex items-center justify-between p-3"
                >
                  <span className="font-semibold">{name}</span>
                  <span className={pill.cls}>{pill.label}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
