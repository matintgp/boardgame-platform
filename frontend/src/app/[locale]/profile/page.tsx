"use client";

import { useLocale, useTranslations } from "next-intl";
import { FormEvent, useEffect, useState } from "react";
import { api, ensureSession, type SessionUser } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";

export default function ProfilePage() {
  const t = useTranslations("profile");
  const locale = useLocale();
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
    <div className="mx-auto max-w-md">
      <h1 className="mb-6 text-2xl font-bold">{t("title")}</h1>
      <div className="card mb-6 p-5">
        <div className="flex justify-between py-1 text-sm">
          <span className="muted">{t("username")}</span>
          <span className="font-semibold">{user.username}</span>
        </div>
        <div className="flex justify-between py-1 text-sm">
          <span className="muted">{t("email")}</span>
          <span>{user.email}</span>
        </div>
        <div className="flex justify-between py-1 text-sm">
          <span className="muted">{t("rating")}</span>
          <span className="font-bold text-[var(--accent)]">{user.rating}</span>
        </div>
      </div>

      <div className="card p-5">
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
      <p className="muted mt-4 text-xs">
        {locale === "fa" ? "پس از تغییر پسورد، همه‌ی دستگاه‌ها از حساب خارج می‌شوند." : "After changing your password, all devices are logged out."}
      </p>
    </div>
  );
}
