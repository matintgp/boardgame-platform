"use client";

import { useEffect, useState } from "react";
import { parseExpiryMs, remainingLobby } from "@/lib/lobbyExpiry";

export default function LobbyExpiryNote({
  expiresAt,
  createdAt,
  status,
  expiredLabel,
  expiresIn,
}: {
  expiresAt?: string | number | null;
  createdAt?: string | number | null;
  status?: string | null;
  expiredLabel: string;
  expiresIn: (p: { time: string }) => string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const expiryMs = parseExpiryMs({ expires_at: expiresAt, created_at: createdAt });
  const aborted = status === "aborted";

  useEffect(() => {
    if (aborted || expiryMs == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [aborted, expiryMs]);

  if (aborted) {
    return <p className="lobby-ttl is-expired">⏳ {expiredLabel}</p>;
  }
  const clock = remainingLobby(expiryMs, now);
  if (!clock) return null;
  return (
    <p
      className={`lobby-ttl ${clock.expired ? "is-expired" : clock.urgent ? "is-urgent" : ""}`}
    >
      ⏳ {clock.expired ? expiredLabel : expiresIn({ time: clock.label })}
    </p>
  );
}

export function lobbyTimedOut(
  status: string | null | undefined,
  expiresAt?: string | number | null,
  createdAt?: string | number | null
): boolean {
  if (status === "aborted") return true;
  return remainingLobby(parseExpiryMs({ expires_at: expiresAt, created_at: createdAt }))?.expired === true;
}
