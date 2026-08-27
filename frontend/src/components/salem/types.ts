/**
 * Salem client ↔ engine contract (commit c375b57).
 *
 * Game type id: `salem`. Engine: backend/app/games/salem_engine.py
 *
 * Actions via GameSocket `{ type: "action", room, action, payload }`:
 *   play_card        { card_id, target?, extra? }
 *   conspiracy_take  { tryal_index }
 *   night_kill       { target }
 *   gavel            { target }
 *   confess          { tryal_index }
 *   confess_skip     {}
 *   tick             {}   // auto-skip leftover confessions after confess_deadline
 *
 * Phases: day | conspiracy | night | confess | over
 * you.hand is string card ids. you.tryals: { id, revealed } (TRYAL_* ids).
 */

export type SalemPhase = "day" | "conspiracy" | "night" | "confess" | "over";
export type CardColor = "red" | "green" | "blue" | "black";
export type TryalKind = "witch" | "innocent" | "constable";
export type SalemWinner = "town" | "witches";

export interface SalemTownHall {
  id: string;
  name: string;
}

export interface SalemPublicTryals {
  revealed: string[];
  facedown: number;
}

export interface SalemYouTryal {
  id: string;
  revealed: boolean;
}

export interface SalemYou {
  seat: number;
  hand: string[];
  tryals: SalemYouTryal[];
  is_witch: boolean;
  is_constable: boolean;
  alive: boolean;
  teammates?: number[];
  my_conspiracy_pick?: number | null;
  my_night_kill?: number | null;
  my_gavel?: number | null;
}

export interface SalemResult {
  reason?: string;
  winner_role: SalemWinner;
  winner_seats: number[];
  winner_seat?: number | null;
  roles?: Record<string, string>;
  tryals?: Record<string, SalemYouTryal[]>;
}

export interface SalemState {
  phase: SalemPhase;
  round: number;
  alive: Record<string, boolean>;
  town_hall: Record<string, SalemTownHall | string>;
  marks: Record<string, number>;
  tryals: Record<string, SalemPublicTryals>;
  blues: Record<string, string[]>;
  deck_left: number;
  discard_top?: string | null;
  last_night: { killed: number | null } | null;
  last_reveal?: { seat: number; index: number; id: string } | null;
  confess_deadline: number | null;
  result?: SalemResult | null;
  current_seat: number | null;
  you: SalemYou | null;
}

export interface PlayerInfo {
  seat: number;
  user: { id: string; username: string; rating?: number };
}

export interface GameView {
  id: string;
  game_type: string;
  status: string;
  max_players?: number;
  min_players?: number;
  players: PlayerInfo[];
  your_seat: number | null;
  is_host?: boolean;
  state?: SalemState;
}

export const SALEM_MIN_PLAYERS = 4;
export const SALEM_MAX_FALLBACK = 12;
export const MARK_THRESHOLD = 7;

export function seatCount(state: SalemState | null): number {
  if (!state?.alive) return 0;
  return Object.keys(state.alive).length;
}

export function leftSeat(seat: number, n: number): number {
  if (n <= 0) return seat;
  return (seat - 1 + n) % n;
}

export function isSeatAlive(state: SalemState | null, seat: number): boolean {
  if (!state) return true;
  const v = state.alive?.[String(seat)];
  if (typeof v === "boolean") return v;
  if (state.you && state.you.seat === seat && typeof state.you.alive === "boolean") {
    return state.you.alive;
  }
  return true;
}

export function marksOf(state: SalemState | null, seat: number): number {
  if (!state?.marks) return 0;
  const v = state.marks[String(seat)];
  return typeof v === "number" ? v : 0;
}

export function townHallOf(state: SalemState | null, seat: number): SalemTownHall | null {
  if (!state?.town_hall) return null;
  const raw = state.town_hall[String(seat)];
  if (raw == null) return null;
  if (typeof raw === "string") return { id: raw, name: raw };
  return { id: raw.id, name: raw.name || raw.id };
}

export function bluesOf(state: SalemState | null, seat: number): string[] {
  if (!state?.blues) return [];
  const row = state.blues[String(seat)];
  return Array.isArray(row) ? row.map(String) : [];
}

export function tryalsOf(state: SalemState | null, seat: number): SalemPublicTryals {
  const empty: SalemPublicTryals = { revealed: [], facedown: 0 };
  if (!state?.tryals) return empty;
  const row = state.tryals[String(seat)];
  if (!row || typeof row !== "object") return empty;
  return {
    revealed: Array.isArray(row.revealed) ? row.revealed.map(String) : [],
    facedown: typeof row.facedown === "number" ? row.facedown : 0,
  };
}

export function nameOf(players: PlayerInfo[], seat: number): string {
  return players.find((p) => p.seat === seat)?.user.username ?? `#${seat}`;
}

export function polarOval(index: number, total: number, rx = 42, ry = 34) {
  const n = Math.max(total, 1);
  const angle = Math.PI / 2 + (index / n) * 2 * Math.PI;
  return {
    left: `${50 + rx * Math.cos(angle)}%`,
    top: `${50 + ry * Math.sin(angle)}%`,
  };
}

export function extractState(payload: unknown): SalemState | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const nested = p.state;
  if (nested && typeof nested === "object" && nested !== null && "phase" in nested) {
    return normalizeState(nested as Record<string, unknown>);
  }
  if ("phase" in p && ("you" in p || "marks" in p || "deck_left" in p || "town_hall" in p)) {
    return normalizeState(p);
  }
  return null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function normalizeHand(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => (typeof c === "string" ? c : String((c as { id?: string })?.id ?? c)));
}

function normalizeYouTryals(raw: unknown): SalemYouTryal[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => {
    if (c && typeof c === "object") {
      const o = c as { id?: string; kind?: string; revealed?: boolean };
      const id =
        typeof o.id === "string"
          ? o.id
          : o.kind === "witch"
            ? "tryal_witch"
            : o.kind === "constable"
              ? "tryal_constable"
              : "tryal_innocent";
      return { id, revealed: Boolean(o.revealed) };
    }
    return { id: String(c), revealed: false };
  });
}

function normalizeYou(raw: unknown): SalemYou | null {
  if (!raw || typeof raw !== "object") return null;
  const y = raw as Record<string, unknown>;
  if (typeof y.seat !== "number") return null;
  return {
    seat: y.seat,
    hand: normalizeHand(y.hand),
    tryals: normalizeYouTryals(y.tryals),
    is_witch: Boolean(y.is_witch),
    is_constable: Boolean(y.is_constable),
    alive: y.alive !== false,
    teammates: Array.isArray(y.teammates) ? y.teammates.map(Number) : undefined,
    my_conspiracy_pick:
      y.my_conspiracy_pick == null ? null : Number(y.my_conspiracy_pick),
    my_night_kill: y.my_night_kill == null ? null : Number(y.my_night_kill),
    my_gavel: y.my_gavel == null ? null : Number(y.my_gavel),
  };
}

function normalizeState(p: Record<string, unknown>): SalemState {
  const resultRaw = asRecord(p.result);
  let result: SalemResult | null = null;
  if (p.result && typeof p.result === "object") {
    const winner_role = (resultRaw.winner_role ?? resultRaw.winner) as SalemWinner;
    result = {
      reason: typeof resultRaw.reason === "string" ? resultRaw.reason : undefined,
      winner_role: winner_role === "witches" ? "witches" : "town",
      winner_seats: Array.isArray(resultRaw.winner_seats)
        ? resultRaw.winner_seats.map(Number)
        : [],
      winner_seat: resultRaw.winner_seat == null ? null : Number(resultRaw.winner_seat),
      roles: asRecord(resultRaw.roles) as Record<string, string>,
      tryals: resultRaw.tryals as SalemResult["tryals"],
    };
  }

  const lastNight = p.last_night;
  let publicNight: { killed: number | null } | null = null;
  if (lastNight && typeof lastNight === "object") {
    const k = (lastNight as { killed?: number | null }).killed;
    publicNight = { killed: k == null ? null : Number(k) };
  }

  const deadline = p.confess_deadline;
  return {
    phase: p.phase as SalemPhase,
    round: Number(p.round ?? 1),
    alive: (p.alive as Record<string, boolean>) ?? {},
    town_hall: (p.town_hall as SalemState["town_hall"]) ?? {},
    marks: (p.marks as Record<string, number>) ?? {},
    tryals: (p.tryals as Record<string, SalemPublicTryals>) ?? {},
    blues: (p.blues as Record<string, string[]>) ?? {},
    deck_left: Number(p.deck_left ?? p.deck_count ?? 0),
    discard_top: (p.discard_top as string | null) ?? null,
    last_night: publicNight,
    last_reveal: (p.last_reveal as SalemState["last_reveal"]) ?? null,
    confess_deadline:
      deadline == null || deadline === "" ? null : Number(deadline),
    result,
    current_seat: p.current_seat == null ? null : Number(p.current_seat),
    you: normalizeYou(p.you),
  };
}

export function unrevealedOwnIndexes(you: SalemYou | null): number[] {
  if (!you) return [];
  return you.tryals
    .map((tr, i) => (tr.revealed ? -1 : i))
    .filter((i) => i >= 0);
}

/** Prefix heuristic: revealed occupy the front of the public row. */
export function unrevealedPublicIndexes(row: SalemPublicTryals): number[] {
  const out: number[] = [];
  const start = row.revealed.length;
  for (let i = 0; i < row.facedown; i++) out.push(start + i);
  return out;
}

export function normalizePhase(phase: SalemPhase | null | undefined): EnginePhase | null {
  if (!phase) return null;
  if (phase === "dawn" || phase === "turn") return "day";
  return phase;
}

export function winnerOf(result: SalemResult | null | undefined): SalemWinner | null {
  if (!result) return null;
  if (result.winner === "town" || result.winner === "witches") return result.winner;
  if (result.winner_role === "town" || result.winner_role === "witches") return result.winner_role;
  return null;
}

export function unrevealedIndexes(state: SalemState | null, seat: number): number[] {
  const p = publicPlayer(state, seat);
  if (p) return unrevealedTryalIndexes(p);
  const info = publicTryalsOf(state, seat);
  const known = new Set(info.revealed.map((r) => r.index).filter((i): i is number => typeof i === "number"));
  if (known.size === info.revealed.length && info.total) {
    return Array.from({ length: info.total }, (_, i) => i).filter((i) => !known.has(i));
  }
  return Array.from({ length: info.total }, (_, i) => i);
}
