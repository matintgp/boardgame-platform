"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ensureSession, getCurrentUser, logout, onAuthChange, type SessionUser } from "@/lib/api";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import Avatar from "@/components/Avatar";

export default function Navbar() {
  const t = useTranslations("app");
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const [user, setUser] = useState<SessionUser | null>(() => getCurrentUser());
  const [ready, setReady] = useState(() => getCurrentUser() != null);

  useEffect(() => {
    const unsub = onAuthChange(setUser);
    ensureSession().then((u) => {
      setUser(u);
      setReady(true);
    });
    return unsub;
  }, []);

  async function onLogout() {
    await logout();
    router.replace("/login");
  }

  const active = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const linkClass = (href: string) =>
    `nav-link ${active(href) ? "nav-link-active" : ""}`;

  return (
    <header className="salon-nav">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="shrink-0 text-lg font-bold text-[var(--accent)]">
          {t("title")}
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-sm">
          <Link href="/lobby" className={linkClass("/lobby")}>
            {t("lobby")}
          </Link>
          <Link href="/friends" className={linkClass("/friends")}>
            {t("friends")}
          </Link>
          <div
            className="flex items-center gap-1 text-xs font-semibold tracking-wide"
            dir="ltr"
            role="group"
            aria-label={t("language")}
          >
            <Link
              href={pathname}
              locale="fa"
              className={
                locale === "fa"
                  ? "text-[var(--accent)]"
                  : "muted hover:text-[var(--accent)]"
              }
              aria-current={locale === "fa" ? "true" : undefined}
            >
              FA
            </Link>
            <span className="muted" aria-hidden="true">
              |
            </span>
            <Link
              href={pathname}
              locale="en"
              className={
                locale === "en"
                  ? "text-[var(--accent)]"
                  : "muted hover:text-[var(--accent)]"
              }
              aria-current={locale === "en" ? "true" : undefined}
            >
              EN
            </Link>
          </div>
          {!ready ? null : user ? (
            <>
              <Link
                href="/profile"
                className={`flex items-center gap-2 rounded-full border border-[var(--gold-line)] bg-[rgba(24,27,34,0.55)] py-1 ps-1 pe-3 hover:border-[rgba(212,162,78,0.45)] ${
                  active("/profile") ? "border-[rgba(212,162,78,0.5)]" : ""
                }`}
              >
                <Avatar name={user.username} size="sm" />
                <span className="leading-tight">
                  <span className="block text-xs font-semibold">{user.username}</span>
                  <span className="muted block text-[0.65rem]">{user.rating}</span>
                </span>
              </Link>
              <button onClick={onLogout} className="btn btn-ghost !py-1.5 !px-3">
                {t("logout")}
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className={linkClass("/login")}>
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
