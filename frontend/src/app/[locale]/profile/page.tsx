"use client";

import { useTranslations } from "next-intl";
import { FormEvent, useEffect, useState } from "react";
import { api, ensureSession, type SessionUser } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";
import Avatar from "@/components/Avatar";

export default function ProfilePage() {
  const t = useTranslations("profile");
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ensureSession().then((u) => {
      if (!u) {
        router.replace("/login");
        return;
      }
      setUser(u);
    });
  }, []);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      setMsg({ ok: true, text: t("passwordChanged") });
      setCurrent("");
      setNext("");
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : t("failed") });
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div className="enter">
        <p className="kicker">{t("kicker")}</p>
        <h1 className="mt-1 text-3xl font-bold">{t("title")}</h1>
      </div>

      <div className="card enter enter-d1 flex items-center gap-5 p-6">
        <Avatar name={user.username} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="text-xl font-bold">{user.username}</div>
          <div className="muted mt-1 truncate text-sm">{user.email}</div>
        </div>
        <div className="stat-feature">
          <span className="muted text-xs">{t("rating")}</span>
          <strong>{user.rating}</strong>
        </div>
      </div>

      <div className="card enter enter-d2 p-6">
        <h2 className="mb-3 font-semibold">{t("changePassword")}</h2>
        <form onSubmit={changePassword} className="flex flex-col gap-3">
          <label className="text-sm">
            {t("currentPassword")}
            <input
              className="input mt-1"
              type="password"
              required
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label className="text-sm">
            {t("newPassword")}
            <input
              className="input mt-1"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </label>
          {msg && (
            <p className={`text-sm ${msg.ok ? "text-green-400" : "text-red-400"}`}>
              {msg.text}
            </p>
          )}
          <button className="btn btn-primary" disabled={busy}>
            {t("save")}
          </button>
        </form>
        <p className="muted mt-3 text-xs">{t("logoutEverywhere")}</p>
      </div>
    </div>
  );
}
