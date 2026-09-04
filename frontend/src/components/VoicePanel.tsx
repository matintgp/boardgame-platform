"use client";

import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent } from "livekit-client";
import { api } from "@/lib/api";

/**
 * Voice chat panel (LiveKit). Joins `voice:{gameId}` on demand.
 * Mic permission is requested by the browser on first join.
 * Collapsed by default — LiveKit join is roadmap phase 3.
 */
export default function VoicePanel({
  gameId,
  selfName,
  labels,
  defaultCollapsed = true,
}: {
  gameId: string;
  selfName: string | undefined;
  labels: { join: string; leave: string; mute: string; unmute: string; title: string; micError: string };
  defaultCollapsed?: boolean;
}) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [peers, setPeers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!defaultCollapsed);
  const roomRef = useRef<Room | null>(null);

  function refreshPeers(room: Room) {
    const names: string[] = [];
    room.remoteParticipants.forEach((p) => names.push(p.identity || "player"));
    setPeers(names);
  }

  async function leave() {
    const room = roomRef.current;
    if (room) {
      await room.disconnect().catch(() => undefined);
      roomRef.current = null;
    }
    setJoined(false);
    setPeers([]);
  }

  async function joinVoice() {
    setError(null);
    setBusy(true);
    try {
      const { token, url } = await api<{ token: string; url: string; identity: string }>(
        `/api/games/${gameId}/voice-token`
      );
      const room = new Room({ adaptiveStream: false, dynacast: false });
      roomRef.current = room;
      room.on(RoomEvent.ParticipantConnected, () => refreshPeers(room));
      room.on(RoomEvent.ParticipantDisconnected, () => refreshPeers(room));
      room.on(RoomEvent.TrackMuted, () => refreshPeers(room));
      room.on(RoomEvent.TrackUnmuted, () => refreshPeers(room));
      room.on(RoomEvent.Disconnected, () => {
        setJoined(false);
        setPeers([]);
      });
      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setMuted(false);
      setJoined(true);
      refreshPeers(room);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "voice error";
      setError(/permission|denied|not allowed/i.test(msg) ? labels.micError : msg);
      await leave();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    return () => {
      void roomRef.current?.disconnect().catch(() => undefined);
      roomRef.current = null;
    };
  }, []);

  const peerCount = peers.length + (joined ? 1 : 0);

  return (
    <details
      className="card voice-booth h-fit self-start overflow-hidden"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="chat-booth-summary cursor-pointer list-none px-4 py-3 marker:content-none">
        <span className="flex items-center justify-between gap-2">
          <span className="type-h3">{labels.title}</span>
          <span className="muted text-xs font-normal" aria-hidden="true">
            {open ? "▴" : "▾"}
          </span>
        </span>
      </summary>
      <div className="px-4 pb-4">
        {!joined ? (
          <button type="button" className="btn btn-primary w-full" onClick={joinVoice} disabled={busy}>
            {labels.join}
          </button>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="voice-live">● {labels.title}</span>
              <span className="muted">{peerCount}</span>
            </div>
            <ul className="voice-peers muted">
              {selfName && (
                <li className={muted ? "is-muted" : ""}>
                  {selfName}
                  {muted ? " · muted" : ""}
                </li>
              )}
              {peers.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-ghost flex-1"
                onClick={() => {
                  const room = roomRef.current;
                  if (!room) return;
                  const next = !muted;
                  void room.localParticipant.setMicrophoneEnabled(!next);
                  setMuted(next);
                }}
              >
                {muted ? labels.unmute : labels.mute}
              </button>
              <button type="button" className="btn btn-ghost flex-1 text-red-400" onClick={leave}>
                {labels.leave}
              </button>
            </div>
          </div>
        )}
        {error && <p className="mt-2 text-sm text-red-400" role="alert">{error}</p>}
      </div>
    </details>
  );
}
