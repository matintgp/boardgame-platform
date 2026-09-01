import { api } from "@/lib/api";

/** Seat the current user on a rematch invite, then the caller navigates. */
export async function joinRematchTable(gameId: string): Promise<void> {
  try {
    await api(`/api/games/${gameId}/join`, { method: "POST" });
  } catch (e) {
    const msg = e instanceof Error ? e.message.toLowerCase() : "";
    if (msg.includes("already joined")) return;
    throw e;
  }
}
