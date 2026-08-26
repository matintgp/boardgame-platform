"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ensureSession, logout, onAuthChange, type SessionUser } from "@/lib/api";

export default function Navbar() {
  const t = useTranslations("app");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Re-render on every auth change (login/register/logout/token refresh) -
    // the layout does not remount between client-side navigations.
    const unsub = onAuthChange(setUser);
    ensureSession().finally(() => setReady(true));
    return unsub;
  }, []);

  async function onLogout() {
    await logout();
    window.location.href = "/login";
  }

  return (
    <header className="border-b border-[var(--border)]">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <a href="/" className="text-lg font-bold text-[var(--accent)]">♟ {t("title")}</a>
        <div className="flex items-center gap-4 text-sm">
          <a href="/lobby" className="hover:text-[var(--accent)]">{t("lobby")}</a>
          <a href="/friends" className="hover:text-[var(--accent)]">{t("friends")}</a>
          {!ready ? null : user ? (
            <>
              <a href="/profile" className="muted hover:text-[var(--accent)]">
                {user.username} · {user.rating}
              </a>
              <button onClick={onLogout} className="btn btn-ghost !py-1.5 !px-3">
                {t("logout")}
              </button>
            </>
          ) : (
            <>
              <a href="/login" className="hover:text-[var(--accent)]">{t("login")}</a>
              <a href="/register" className="btn btn-primary !py-1.5 !px-3">{t("register")}</a>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
