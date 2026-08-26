"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ensureSession, logout, onAuthChange, type SessionUser } from "@/lib/api";
import { Link, useRouter } from "@/i18n/navigation";

export default function Navbar() {
  const t = useTranslations("app");
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthChange(setUser);
    ensureSession().finally(() => setReady(true));
    return unsub;
  }, []);

  async function onLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <header className="border-b border-[var(--border)]">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-bold text-[var(--accent)]">
          ♟ {t("title")}
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/lobby" className="hover:text-[var(--accent)]">
            {t("lobby")}
          </Link>
          <Link href="/friends" className="hover:text-[var(--accent)]">
            {t("friends")}
          </Link>
          {!ready ? null : user ? (
            <>
              <Link href="/profile" className="muted hover:text-[var(--accent)]">
                {user.username} · {user.rating}
              </Link>
              <button onClick={onLogout} className="btn btn-ghost !py-1.5 !px-3">
                {t("logout")}
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="hover:text-[var(--accent)]">
                {t("login")}
              </Link>
              <Link href="/register" className="btn btn-primary !py-1.5 !px-3">
                {t("register")}
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
