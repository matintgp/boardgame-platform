"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api, ensureSession } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";

interface FriendEntry {
  request_id: string;
  user_id: string;
  status: string;
  direction: string;
}
interface Profile {
  id: string;
  username: string;
  rating: number;
}

export default function FriendsPage() {
  const t = useTranslations("friends");
  const router = useRouter();
  const [user, setUser] = useState<Profile | null>(null);
  const [entries, setEntries] = useState<FriendEntry[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);

  async function load() {
    const list = await api<FriendEntry[]>("/api/friends");
    setEntries(list);
    // Resolve names for entries we don't know yet.
    const missing = list
      .map((e) => e.user_id)
      .filter((id) => !(id in profiles));
    for (const id of missing) {
      try {
        const p = await api<Profile>(`/api/users/${id}`);
        setProfiles((prev) => ({ ...prev, [id]: p }));
      } catch { /* ignore */ }
    }
  }

  useEffect(() => {
    ensureSession().then((u) => {
      if (u) {
        setUser(u);
        void load();
      } else {
        router.replace("/login");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search(q: string) {
    setQuery(q);
    if (q.length < 2) return setResults([]);
    setResults(await api<Profile[]>(`/api/friends/search?q=${encodeURIComponent(q)}`));
  }

  async function add(username: string) {
    await api("/api/friends/request", {
      method: "POST",
      body: JSON.stringify({ username }),
    });
    setQuery("");
    setResults([]);
    void load();
  }

  async function respond(requestId: string, accept: boolean) {
    await api("/api/friends/respond", {
      method: "POST",
      body: JSON.stringify({ request_id: requestId, accept }),
    });
    void load();
  }

  const accepted = entries.filter((e) => e.status === "accepted");
  const incoming = entries.filter(
    (e) => e.status === "pending" && e.direction === "incoming"
  );
  const outgoing = entries.filter(
    (e) => e.status === "pending" && e.direction === "outgoing"
  );

  const nameOf = (id: string) =>
    profiles[id]?.username ?? (id === user?.id ? user.username : `#${id.slice(0, 6)}`);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold">{t("title")}</h1>

      <div className="card flex gap-2 p-4">
        <input
          className="input"
          placeholder={t("addPlaceholder")}
          value={query}
          onChange={(e) => search(e.target.value)}
        />
      </div>
      {results.length > 0 && (
        <ul className="flex flex-col gap-2">
          {results.map((r) => (
            <li key={r.id} className="card flex items-center justify-between p-3">
              <span>{r.username} · {r.rating}</span>
              <button className="btn btn-ghost" onClick={() => add(r.username)}>
                {t("add")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <section>
        <h2 className="mb-2 font-semibold">{t("incoming")}</h2>
        {incoming.map((e) => (
          <div key={e.request_id} className="card mb-2 flex items-center justify-between p-3">
            <span>{nameOf(e.user_id)}</span>
            <span className="flex gap-2">
              <button className="btn btn-primary" onClick={() => respond(e.request_id, true)}>
                ✓ {t("accept")}
              </button>
              <button className="btn btn-ghost" onClick={() => respond(e.request_id, false)}>
                ✕ {t("reject")}
              </button>
            </span>
          </div>
        ))}
        {incoming.length === 0 && <p className="muted text-sm">—</p>}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">{t("outgoing")}</h2>
        {outgoing.map((e) => (
          <div key={e.request_id} className="card mb-2 p-3">{nameOf(e.user_id)} ⏳</div>
        ))}
        {outgoing.length === 0 && <p className="muted text-sm">—</p>}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">{t("accepted")}</h2>
        {accepted.length === 0 && <p className="muted">{t("noFriends")}</p>}
        {accepted.map((e) => (
          <div key={e.request_id} className="card mb-2 p-3">
            {nameOf(e.user_id)}
          </div>
        ))}
      </section>
    </div>
  );
}
