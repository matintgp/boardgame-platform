"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { api, ensureSession } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";
import Avatar from "@/components/Avatar";

interface FriendEntry {
  request_id: string;
  user_id: string;
  status: string;
  direction: string;
  username?: string;
  rating?: number;
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
    const found = await api<Profile[]>(`/api/friends/search?q=${encodeURIComponent(q)}`);
    setResults(found.filter((p) => p.id !== user?.id));
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

  const nameOf = (e: FriendEntry) =>
    e.username ??
    profiles[e.user_id]?.username ??
    (e.user_id === user?.id ? user.username : `#${e.user_id.slice(0, 6)}`);

  const ratingOf = (e: FriendEntry) =>
    e.rating ?? profiles[e.user_id]?.rating;

  function PersonRow({
    name,
    rating,
    children,
  }: {
    name: string;
    rating?: number;
    children?: ReactNode;
  }) {
    return (
      <div className="card flex items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={name} />
          <div className="min-w-0">
            <div className="truncate font-semibold">{name}</div>
            {rating != null && (
              <div className="muted text-xs">
                {t("rating")} · {rating}
              </div>
            )}
          </div>
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="enter">
        <p className="kicker">{t("kicker")}</p>
        <h1 className="mt-1 text-3xl font-bold">{t("title")}</h1>
        <p className="muted mt-1 text-sm">{t("subtitle")}</p>
      </div>

      <div className="card enter enter-d1 relative z-20 p-4">
        <label className="text-sm">
          {t("searchLabel")}
          <input
            className="input mt-1"
            placeholder={t("addPlaceholder")}
            value={query}
            onChange={(e) => search(e.target.value)}
            autoComplete="off"
          />
        </label>
        {results.filter((r) => r.id !== user?.id).length > 0 && (
          <ul className="search-drop">
            {results.filter((r) => r.id !== user?.id).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 rounded-lg p-2 hover:bg-[rgba(212,162,78,0.08)]">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={r.username} size="sm" />
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{r.username}</div>
                    <div className="muted text-xs">
                      {t("rating")} · {r.rating}
                    </div>
                  </div>
                </div>
                <button className="btn btn-primary !py-1.5 !px-3" onClick={() => add(r.username)}>
                  {t("add")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.length >= 2 && results.length === 0 && (
          <p className="muted mt-2 text-sm">{t("noResults")}</p>
        )}
      </div>

      <section className="enter enter-d2">
        <h2 className="mb-2 font-semibold">{t("incoming")}</h2>
        <div className="enter-stagger flex flex-col gap-2">
          {incoming.map((e) => (
            <PersonRow key={e.request_id} name={nameOf(e)} rating={ratingOf(e)}>
              <span className="flex shrink-0 gap-2">
                <button className="btn btn-primary !py-1.5 !px-3" onClick={() => respond(e.request_id, true)}>
                  {t("accept")}
                </button>
                <button className="btn btn-ghost !py-1.5 !px-3" onClick={() => respond(e.request_id, false)}>
                  {t("reject")}
                </button>
              </span>
            </PersonRow>
          ))}
        </div>
        {incoming.length === 0 && (
          <div className="card empty-state">
            <p>{t("emptyIncoming")}</p>
          </div>
        )}
      </section>

      <section className="enter enter-d3">
        <h2 className="mb-2 font-semibold">{t("outgoing")}</h2>
        <div className="enter-stagger flex flex-col gap-2">
          {outgoing.map((e) => (
            <PersonRow key={e.request_id} name={nameOf(e)} rating={ratingOf(e)}>
              <span className="pill pill-wait">{t("pending")}</span>
            </PersonRow>
          ))}
        </div>
        {outgoing.length === 0 && (
          <div className="card empty-state">
            <p>{t("emptyOutgoing")}</p>
          </div>
        )}
      </section>

      <section className="enter enter-d4">
        <h2 className="mb-2 font-semibold">{t("accepted")}</h2>
        {accepted.length === 0 && (
          <div className="card empty-state">
            <p>{t("noFriends")}</p>
          </div>
        )}
        <div className="enter-stagger flex flex-col gap-2">
          {accepted.map((e) => (
            <PersonRow key={e.request_id} name={nameOf(e)} rating={ratingOf(e)} />
          ))}
        </div>
      </section>
    </div>
  );
}
