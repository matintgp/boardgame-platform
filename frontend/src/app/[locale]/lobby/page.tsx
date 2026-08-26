"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ensureSession, type SessionUser } from "@/lib/api";

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

export default function LobbyPage() {
  const t = useTranslations("lobby");
  const router = useRouter();
  const locale = useLocale();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [lobbies, setLobbies] = useState<LobbyInfo[]>([]);
  const [myGames, setMyGames] = useState<MyGame[]>([]);
  const [busy, setBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef(false);

  const refreshLists = useCallback(async () => {
    try {
      const [ls, mine] = await Promise.all([
        api<LobbyInfo[]>("/api/games/lobbies"),
        api<MyGame[]>("/api/games/mine"),
      ]);
      setLobbies(ls);
      setMyGames(mine);
    } catch {
      /* session expired etc. */
    }
  }, []);

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

  async function createTable() {
    setBusy(true);
    try {
      const g = await api<{ id: string }>("/api/games", {
        method: "POST",
        body: JSON.stringify({ game_type: "chess" }),
      });
      router.push(`/game/${g.id}`);
    } finally {
      setBusy(false);
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

  // Quick match: poll the queue endpoint until paired.
  useEffect(() => {
    if (!searching) return;
    let stopped = false;
    const poll = async () => {
      while (!stopped && searchRef.current) {
        try {
          const res = await api<{ status: string; game_id?: string }>(
            "/api/games/queue",
            { method: "POST", body: JSON.stringify({ game_type: "chess" }) }
          );
          if (res.status === "matched" && res.game_id) {
            searchRef.current = false;
            setSearching(false);
            router.push(`/game/${res.game_id}`);
            return;
          }
        } catch {
          searchRef.current = false;
          setSearching(false);
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

  async function quickMatch() {
    setSearching(true);
    searchRef.current = true;
  }

  async function cancelSearch() {
    searchRef.current = false;
    setSearching(false);
    await api("/api/games/queue?game_type=chess", { method: "DELETE" }).catch(
      () => undefined
    );
  }

  const path = (suffix: string) => (locale === "fa" ? suffix : `/en${suffix}`);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        {user && <span className="muted text-sm">{user.username} · {user.rating}</span>}
      </div>

      {searching ? (
        <div className="card flex items-center justify-between p-4">
          <span className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 animate-ping rounded-full bg-[var(--accent)]" />
            {t("searching")}
          </span>
          <button className="btn btn-ghost" onClick={cancelSearch}>
            {t("cancel")}
          </button>
        </div>
      ) : (
        <div className="flex gap-3">
          <button className="btn btn-primary" onClick={quickMatch}>
            ⚡ {t("quickMatch")}
          </button>
          <button
            className="btn btn-ghost"
            onClick={async () => {
              setBusy(true);
              try {
                const g = await api<{ id: string }>("/api/games", {
                  method: "POST",
                  body: JSON.stringify({ game_type: "mafia" }),
                });
                router.push(`/game/${g.id}`);
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            🎭 {t("createMafia")}
          </button>
          <button
            className="btn btn-ghost"
            onClick={async () => {
              setBusy(true);
              try {
                const g = await api<{ id: string }>("/api/games", {
                  method: "POST",
                  body: JSON.stringify({ game_type: "rokugan" }),
                });
                router.push(`/game/${g.id}`);
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            ⚔ {t("createRokugan")}
          </button>
          <button className="btn btn-ghost" onClick={createTable} disabled={busy}>
            ♞ {t("createChess")}
          </button>
        </div>
      )}

      <button className="btn btn-ghost self-start" onClick={createTable} disabled={busy}>
        ♞ {t("createChess")}
      </button>

      {joinError && <p className="text-sm text-red-400">{joinError}</p>}

      <section>
        <h2 className="mb-3 font-semibold">{t("openLobbies")}</h2>
        {lobbies.length === 0 && <p className="muted">{t("empty")}</p>}
        <div className="flex flex-col gap-2">
          {lobbies.map((l) => (
            <div key={l.id} className="card flex items-center justify-between p-4">
              <div>
                <span className="font-semibold">♞ Chess</span>
                <span className="muted ms-3 text-sm">
                  {t("players")}: {l.players.length}/{l.max_players}
                </span>
              </div>
              <button className="btn btn-ghost" onClick={() => join(l.id)}>
                {t("join")}
              </button>
            </div>
          ))}
        </div>
      </section>

      {myGames.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">{t("yourGames")}</h2>
          <div className="flex flex-col gap-2">
            {myGames.map((g) => (
              <a key={g.id} href={path(`/game/${g.id}`)}
                 className="card flex items-center justify-between p-3 hover:border-[var(--accent)]">
                <span>♞ {g.game_type}</span>
                <span className="muted text-sm">{g.status}</span>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
