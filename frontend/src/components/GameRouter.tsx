"use client";

import { useEffect, useState } from "react";
import { api, ensureSession } from "@/lib/api";
import ChessGame from "@/components/ChessGame";
import MafiaGame from "@/components/MafiaGame";
import RokuganGame from "@/components/RokuganGame";

export default function GameRouter({ gameId }: { gameId: string }) {
  const [gameType, setGameType] = useState<string | null>(null);

  useEffect(() => {
    ensureSession().then(async (u) => {
      if (!u) {
        window.location.href = "/login";
        return;
      }
      try {
        const g = await api<{ game_type: string }>(`/api/games/${gameId}`);
        setGameType(g.game_type);
      } catch {
        setGameType("chess"); // child component will surface the error
      }
    });
  }, [gameId]);

  if (gameType === null) return null;
  if (gameType === "rokugan") return <RokuganGame gameId={gameId} />;
  if (gameType === "mafia") return <MafiaGame gameId={gameId} />;
  return <ChessGame gameId={gameId} />;
}
