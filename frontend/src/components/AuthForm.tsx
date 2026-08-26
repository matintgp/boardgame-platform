"use client";

import { useTranslations } from "next-intl";
import { FormEvent, useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";

type Mode = "login" | "register";

export default function AuthForm({ mode }: { mode: Mode }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { login, register } = await import("@/lib/api");
      const result =
        mode === "login"
          ? await login(email, password)
          : await register(email, username, password);
      if (!result.ok) {
        setError(result.error ?? t("genericError"));
        return;
      }
      // Small delay: the Set-Cookie from this response must be committed by the
      // browser before the navigation, or the next page's token refresh 401s.
      await new Promise((r) => setTimeout(r, 400));
      router.replace("/lobby");
    } catch {
      setError(t("genericError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mx-auto max-w-sm p-6">
      <h1 className="mb-4 text-xl font-bold">{mode === "login" ? t("loginTitle") : t("registerTitle")}</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="text-sm">
          {t("email")}
          <input
            className="input mt-1"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {mode === "register" && (
          <label className="text-sm">
            {t("username")}
            <input
              className="input mt-1"
              required
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_]+"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
        )}
        <label className="text-sm">
          {t("password")}
          <input
            className="input mt-1"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>
          {mode === "login" ? t("submitLogin") : t("submitRegister")}
        </button>
      </form>
      <p className="muted mt-4 text-sm">
        {mode === "login" ? (
          <Link href="/register" className="hover:text-[var(--accent)]">{t("noAccount")}</Link>
        ) : (
          <Link href="/login" className="hover:text-[var(--accent)]">{t("haveAccount")}</Link>
        )}
      </p>
    </div>
  );
}
