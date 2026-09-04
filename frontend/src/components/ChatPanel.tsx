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
  defaultCollapsed = false,
}: {
  socket: GameSocket | null;
  selfName: string | undefined;
  room: string;
  title: string;
  placeholder: string;
  sendLabel: string;
  defaultCollapsed?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(!defaultCollapsed);
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

  const body = (
    <>
      <div
        ref={listRef}
        className="chat-log mb-2 max-h-64 flex-1 overflow-auto"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.length === 0 && <p className="muted chat-empty">—</p>}
        {messages.map((m, i) => (
          <div
            key={`${m.seq}-${i}`}
            className={`chat-line ${m.username === selfName ? "is-mine" : ""}`}
          >
            <span className="chat-user">{m.username}</span>
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
      </div>
      <div className="chat-compose flex gap-2">
        <input
          className="input"
          maxLength={500}
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button
          type="button"
          className="btn btn-primary !px-3"
          onClick={send}
          disabled={!text.trim()}
        >
          {sendLabel}
        </button>
      </div>
    </>
  );

  if (defaultCollapsed) {
    return (
      <details
        className="card chat-booth h-fit self-start overflow-hidden"
        open={open}
        onToggle={(e) => setOpen(e.currentTarget.open)}
      >
        <summary className="chat-booth-summary cursor-pointer list-none px-4 py-3 marker:content-none">
          <span className="flex items-center justify-between gap-2">
            <span className="type-h3">{title}</span>
            <span className="muted text-xs font-normal" aria-hidden="true">
              {open ? "▴" : "▾"}
            </span>
          </span>
        </summary>
        <div className="px-4 pb-4">{body}</div>
      </details>
    );
  }

  return (
    <div className="card chat-booth flex max-h-96 flex-col p-4">
      <h3 className="type-h3 mb-2">{title}</h3>
      {body}
    </div>
  );
}
