"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ensureSession, getCurrentUser, onAuthChange, type SessionUser } from "@/lib/api";

export default function HomeHeroCtas() {
  const t = useTranslations("app");
  const [user, setUser] = useState<SessionUser | null>(() => getCurrentUser());

  useEffect(() => {
    const unsub = onAuthChange(setUser);
    ensureSession().then(setUser);
    return unsub;
  }, []);

  return (
    <div className="mt-6 flex flex-wrap justify-center gap-3">
      <Link href="/lobby" className="btn btn-primary">
        {t("playNow")}
      </Link>
      {user ? (
        <Link href="/profile" className="btn btn-ghost">
          {t("profile")}
        </Link>
      ) : (
        <Link href="/register" className="btn btn-ghost">
          {t("register")}
        </Link>
      )}
    </div>
  );
}
