/** Waiting-lobby TTL. Backend must abort at the same window. */
export const LOBBY_TTL_MS = 10 * 60 * 1000;
export const MAX_OPEN_LOBBIES = 2;

export function parseExpiryMs(row: {
  expires_at?: number | string | null;
  created_at?: string | number | null;
}): number | null {
  const raw = row.expires_at;
  if (raw != null && raw !== "") {
    const n = typeof raw === "number" ? raw : Date.parse(String(raw));
    if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  }
  const created = row.created_at;
  if (created == null || created === "") return null;
  const c = typeof created === "number" ? created : Date.parse(String(created));
  if (!Number.isFinite(c)) return null;
  const ms = c < 1e12 ? c * 1000 : c;
  return ms + LOBBY_TTL_MS;
}

export function remainingLobby(expiryMs: number | null, now = Date.now()): {
  expired: boolean;
  label: string;
} | null {
  if (expiryMs == null) return null;
  const left = Math.max(0, expiryMs - now);
  const s = Math.ceil(left / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return {
    expired: left <= 0,
    label: `${m}:${String(r).padStart(2, "0")}`,
  };
}

export function isTooManyLobbies(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("too many") || m.includes("open lobbies") || m.includes("lobby limit");
}
