"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ensureSession, type SessionUser } from "@/lib/api";
import { Link, useRouter } from "@/i18n/navigation";

interface LobbyInfo {
  id: string;
  game_type: string;
  status: string;
  max_players: number;
  players: { seat: number; user: { id: string; username: string } }[];
}
interface MyGame {
  id: string;
  game_type: string;
  status: string;
}

function gameLabel(
  t: ReturnType<typeof useTranslations>,
  gameType: string
): { icon: string; name: string } {
  switch (gameType) {
    case "mafia":
      return { icon: "🎭", name: t("gameMafia") };
    case "rokugan":
      return { icon: "⚔", name: t("gameRokugan") };
    case "chess":
      return { icon: "♞", name: t("gameChess") };
    default:
      return { icon: "♟", name: t("unknownGame") };
  }
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
  const [searching, setSearching] = useState<"chess" | "mafia" | "rokugan" | null>(null);
  const searchRef = useRef<"chess" | "mafia" | "rokugan" | null>(null);

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

  async function createTable(gameType: "chess" | "mafia" | "rokugan") {
    setBusy(gameType);
    setJoinError(null);
    try {
      const g = await api<{ id: string }>("/api/games", {
        method: "POST",
        body: JSON.stringify({ game_type: gameType }),
      });
      router.push(`/game/${g.id}`);
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : t("loadError"));
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
      setJoinError(e instanceof Error ? e.message : "join failed");
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

  function quickMatch(gameType: "chess" | "mafia" | "rokugan") {
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

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        {user && (
          <span className="muted text-sm">
            {user.username} · {user.rating}
          </span>
        )}
      </div>

      {searching ? (
        <div className="card flex items-center justify-between p-4">
          <span className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 animate-ping rounded-full bg-[var(--accent)]" />
            {t("searching")} · {gameLabel(t, searching).icon} {gameLabel(t, searching).name}
          </span>
          <button className="btn btn-ghost" onClick={cancelSearch}>
            {t("cancel")}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <button className="btn btn-primary" onClick={() => quickMatch("chess")}>
            ⚡ {t("quickMatch")} {t("gameChess")}
          </button>
          <button className="btn btn-primary" onClick={() => quickMatch("mafia")}>
            ⚡ {t("quickMatch")} {t("gameMafia")}
          </button>
          <button className="btn btn-primary" onClick={() => quickMatch("rokugan")}>
            ⚡ {t("quickMatch")} {t("gameRokugan")}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => createTable("chess")}
            disabled={busy !== null}
          >
            ♞ {t("createChess")}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => createTable("mafia")}
            disabled={busy !== null}
          >
            🎭 {t("createMafia")}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => createTable("rokugan")}
            disabled={busy !== null}
          >
            ⚔ {t("createRokugan")}
          </button>
        </div>
      )}

      {joinError && <p className="text-sm text-red-400">{joinError}</p>}

      <section>
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
        {!listLoading && !listError && lobbies.length === 0 && (
          <p className="muted">{t("empty")}</p>
        )}
        <div className="flex flex-col gap-2">
          {lobbies.map((l) => {
            const { icon, name } = gameLabel(t, l.game_type);
            return (
              <div key={l.id} className="card flex items-center justify-between p-4">
                <div>
                  <span className="font-semibold">
                    {icon} {name}
                  </span>
                  <span className="muted ms-3 text-sm">
                    {t("players")}: {l.players.length}/{l.max_players}
                  </span>
                </div>
                <button className="btn btn-ghost" onClick={() => join(l.id)}>
                  {t("join")}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {myGames.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">{t("yourGames")}</h2>
          <div className="flex flex-col gap-2">
            {myGames.map((g) => {
              const { icon, name } = gameLabel(t, g.game_type);
              return (
                <Link
                  key={g.id}
                  href={`/game/${g.id}`}
                  className="card flex items-center justify-between p-3 hover:border-[var(--accent)]"
                >
                  <span>
                    {icon} {name}
                  </span>
                  <span className="muted text-sm">{g.status}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
