"use client";

import { getWsUrl, refreshSession } from "./api";

export interface Envelope {
  type: string;
  room?: string;
  seq?: number | null;
  payload?: unknown;
}

type WsStatus = "connecting" | "open" | "closed";
type Handler = (env: Envelope) => void;

/**
 * Resilient game WebSocket.
 * - auto-reconnect with backoff
 * - on every reconnect sends `sync` with the last seen seq so the server
 *   replays exactly what we missed, then we get a fresh snapshot.
 */
export class GameSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private statusHandlers = new Set<(status: WsStatus) => void>();
  private lastSeq = new Map<string, number>(); // room -> last seq applied
  private rooms = new Set<string>();
  private closedByUser = false;
  private retry = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  onMessage(h: Handler) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  onStatus(h: (status: WsStatus) => void) {
    this.statusHandlers.add(h);
    return () => this.statusHandlers.delete(h);
  }

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.closedByUser = false;
    this.emitStatus("connecting");
    // The access token may have expired while we were disconnected (15 min
    // lifetime) - refresh it so the new handshake uses a valid token.
    void refreshSession()
      .catch(() => false)
      .then(() => {
        if (this.closedByUser) return;
        const ws = new WebSocket(getWsUrl());
        this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.emitStatus("open");
      // Re-join rooms and resync missed events after any reconnect.
      for (const room of this.rooms) {
        ws.send(
          JSON.stringify({ type: "sync", room, last_seq: this.lastSeq.get(room) ?? 0 })
        );
      }
      this.pingTimer ??= setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
      }, 25000);
    };

    ws.onmessage = (ev) => {
      try {
        const env = JSON.parse(ev.data) as Envelope;
        if (env.seq != null && env.room) {
          const prev = this.lastSeq.get(env.room) ?? 0;
          if (env.seq > prev) this.lastSeq.set(env.room, env.seq);
        }
        for (const h of this.handlers) h(env);
      } catch {
        /* ignore malformed frame */
      }
    };

    ws.onclose = () => {
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      this.emitStatus("closed");
      if (!this.closedByUser) {
        const delay = Math.min(8000, 500 * 2 ** this.retry++);
        setTimeout(() => this.connect(), delay);
      }
    };
      });
  }

  /** Join + sync a game room. Idempotent. */
  join(room: string) {
    if (!this.rooms.has(room)) this.rooms.add(room);
    this.send({ type: "sync", room, last_seq: this.lastSeq.get(room) ?? 0 });
  }

  sendMove(room: string, uci: string) {
    this.send({ type: "action", room, action: "move", payload: { move: uci } });
  }

  send(obj: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  close() {
    this.closedByUser = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }

  private emitStatus(s: WsStatus) {
    for (const h of this.statusHandlers) h(s);
  }
}
