"use client";

import { useEffect, useRef, useState } from "react";
import type { GameSocket } from "@/lib/gameSocket";
import type { Envelope } from "@/lib/gameSocket";

export interface ChatMsg {
  username: string;
  text: string;
  seq: number;
  mine: boolean;
}

export default function ChatPanel({
  socket,
  selfName,
  room,
  title,
  placeholder,
  sendLabel,
}: {
  socket: GameSocket | null;
  selfName: string | undefined;
  room: string;
  title: string;
  placeholder: string;
  sendLabel: string;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!socket) return;
    const handler = (env: Envelope) => {
      let msg: { username?: string; text?: string } | null = null;
      if (env.type === "chat") {
        msg = env.payload as { username: string; text: string };
      } else if (env.type === "event") {
        const p = env.payload as { action_type?: string; text?: string; username?: string };
        if (p?.action_type === "chat") msg = p;
      }
      if (msg?.text && msg.username) {
        setMessages((prev) =>
          prev.some((m) => m.seq === env.seq)
            ? prev
            : [...prev, { username: msg.username!, text: msg.text!, seq: env.seq ?? 0, mine: false }]
        );
      }
    };
    const off = socket.onMessage(handler);
    return () => {
      off();
    };
  }, [socket]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  function send() {
    const trimmed = text.trim();
    if (!trimmed || !socket) return;
    socket.send({ type: "chat", room, payload: { text: trimmed.slice(0, 500) } });
    setText("");
  }

  return (
    <div className="card flex max-h-96 flex-col p-4">
      <h3 className="mb-2 font-semibold">💬 {title}</h3>
      <div ref={listRef} className="mb-2 max-h-64 flex-1 overflow-auto text-sm">
        {messages.length === 0 && <p className="muted">—</p>}
        {messages.map((m, i) => (
          <div key={i} className="py-0.5">
            <span className={m.username === selfName ? "font-bold text-[var(--accent)]" : "font-bold"}>
              {m.username}:
            </span>{" "}
            {m.text}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="input"
          maxLength={500}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="btn btn-primary !px-3" onClick={send} disabled={!text.trim()}>
          {sendLabel}
        </button>
      </div>
    </div>
  );
}
