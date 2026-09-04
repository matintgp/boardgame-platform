"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { ensureSession, getCurrentUser, logout, onAuthChange, type SessionUser } from "@/lib/api";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import Avatar from "@/components/Avatar";

export default function Navbar() {
  const t = useTranslations("app");
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const [user, setUser] = useState<SessionUser | null>(() => getCurrentUser());
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    const unsub = onAuthChange(setUser);
    ensureSession().then(setUser);
    return unsub;
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  async function onLogout() {
    setMenuOpen(false);
    await logout();
    router.replace("/login");
  }

  const active = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const linkClass = (href: string) =>
    `nav-link ${active(href) ? "nav-link-active" : ""}`;

  const menuLabel = locale === "fa" ? (menuOpen ? "بستن منو" : "باز کردن منو") : (menuOpen ? "Close menu" : "Open menu");

  const langSwitch = (
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
            : "muted transition-colors hover:text-[var(--accent)]"
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
            : "muted transition-colors hover:text-[var(--accent)]"
        }
        aria-current={locale === "en" ? "true" : undefined}
      >
        EN
      </Link>
    </div>
  );

  const authBlock = user ? (
    <>
      <Link
        href="/profile"
        className={`flex shrink-0 items-center gap-2 rounded-full border border-[var(--gold-line)] bg-[rgba(24,27,34,0.55)] py-1 ps-1 pe-3 hover:border-[rgba(212,162,78,0.45)] ${
          active("/profile") ? "border-[rgba(212,162,78,0.5)]" : ""
        }`}
        onClick={() => setMenuOpen(false)}
      >
        <Avatar name={user.username} size="sm" />
        <span className="leading-tight">
          <span className="block whitespace-nowrap text-xs font-semibold">{user.username}</span>
          <span className="muted block text-[0.65rem]">{user.rating}</span>
        </span>
      </Link>
      <button type="button" onClick={onLogout} className="btn btn-ghost !py-1.5 !px-3">
        {t("logout")}
      </button>
    </>
  ) : (
    <>
      <Link href="/login" className={linkClass("/login")} onClick={() => setMenuOpen(false)}>
        {t("login")}
      </Link>
      <Link href="/register" className="btn btn-primary !py-1.5 !px-3" onClick={() => setMenuOpen(false)}>
        {t("register")}
      </Link>
    </>
  );

  return (
    <header className="salon-nav">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3" aria-label={t("title")}>
        <Link href="/" className="brand-mark shrink-0 text-lg font-bold">
          {t("title")}
        </Link>

        <div className="nav-desktop flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-sm">
          <Link href="/lobby" className={linkClass("/lobby")}>
            {t("lobby")}
          </Link>
          <Link href="/friends" className={linkClass("/friends")}>
            {t("friends")}
          </Link>
          {langSwitch}
          {authBlock}
        </div>

        <button
          type="button"
          className="nav-menu-btn btn btn-ghost !px-3 !py-1.5"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          aria-label={menuLabel}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span aria-hidden="true">{menuOpen ? "✕" : "☰"}</span>
        </button>
      </nav>

      {menuOpen && (
        <div id={menuId} className="nav-drawer" role="dialog" aria-modal="true" aria-label={menuLabel}>
          <Link href="/lobby" className={linkClass("/lobby")} onClick={() => setMenuOpen(false)}>
            {t("lobby")}
          </Link>
          <Link href="/friends" className={linkClass("/friends")} onClick={() => setMenuOpen(false)}>
            {t("friends")}
          </Link>
          {langSwitch}
          {authBlock}
        </div>
      )}
    </header>
  );
}
