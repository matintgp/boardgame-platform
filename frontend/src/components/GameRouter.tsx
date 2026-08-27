"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api, ensureSession } from "@/lib/api";
import { Link, useRouter } from "@/i18n/navigation";
import ChessGame from "@/components/ChessGame";
import MafiaGame from "@/components/MafiaGame";
import RokuganGame from "@/components/RokuganGame";
import SalemGame from "@/components/SalemGame";

export default function GameRouter({ gameId }: { gameId: string }) {
  const t = useTranslations("game");
  const router = useRouter();
  const [gameType, setGameType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureSession().then(async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }
      try {
        const g = await api<{ game_type: string }>(`/api/games/${gameId}`);
        if (cancelled) return;
        setError(null);
        setGameType(g.game_type);
      } catch (e) {
        if (cancelled) return;
        setGameType(null);
        setError(e instanceof Error ? e.message : t("loadFailed"));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [gameId, router, t]);

  if (error) {
    return (
      <div className="card mx-auto max-w-md p-6 text-center">
        <p className="text-sm text-red-400">{error}</p>
        <Link href="/lobby" className="btn btn-ghost mt-4 inline-block">
          {t("backToLobby")}
        </Link>
      </div>
    );
  }

  if (gameType === null) {
    return <p className="muted text-center">{t("loadingGame")}</p>;
  }

  if (gameType === "salem") return <SalemGame gameId={gameId} />;
  if (gameType === "rokugan") return <RokuganGame gameId={gameId} />;
  if (gameType === "mafia") return <MafiaGame gameId={gameId} />;
  if (gameType === "chess") return <ChessGame gameId={gameId} />;

  return (
    <div className="card mx-auto max-w-md p-6 text-center">
      <p className="muted">{t("unknownType")}</p>
      <Link href="/lobby" className="btn btn-ghost mt-4 inline-block">
        {t("backToLobby")}
      </Link>
    </div>
  );
}
