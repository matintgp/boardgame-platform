import { use } from "react";
import GameRouter from "@/components/GameRouter";

export default function GameRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <GameRouter gameId={id} />;
}
