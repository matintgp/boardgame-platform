/**
 * Salem client ↔ engine contract (matches backend salem_engine.visible_state).
 *
 * Game type id: `salem`. Display: «سیلم» / "Salem".
 *
 * Actions via GameSocket `{ type: "action", room, action, payload }`:
 *   play_card        { card_id, target?, extra?: { tryal_index?, from_seat? } }
 *   conspiracy_take  { tryal_index }   living players, tryal from seat to the left
 *   night_kill       { target }        living witches, consensus (all same target)
 *   gavel            { target }        living constable
 *   confess          { tryal_index }
 *   confess_skip
 *   tick                               expire leftover confessions
 *
 * Night must not leak witch seats to town. Spectator seat=None hides hands/tryal kinds.
 */

export type EnginePhase = "day" | "conspiracy" | "night" | "confess" | "over";
export type SalemPhase = EnginePhase | "dawn" | "turn";
export type CardColor = "red" | "green" | "blue" | "black";
export type TryalKind = "witch" | "town" | "constable";
export type SalemWinner = "town" | "witches";

export interface SalemCard {
  id: string;
  color: CardColor;
  title: string;
  text: string;
}

export interface TownHall {
  id: string;
  label: string;
  name?: string;
}

export interface BlueAttachment {
  id: string;
  label: string;
}

export interface RevealedTryal {
  kind: TryalKind;
  index?: number;
  id?: string;
}

export interface SalemPlayerPublic {
  seat: number;
  town_hall: TownHall | string | null;
  accusations: number;
  blue_cards: BlueAttachment[];
  tryal_count: number;
  revealed_tryals: RevealedTryal[];
  confessed?: boolean;
}

export interface SalemTryalPrivate {
  index: number;
  kind: TryalKind;
  revealed: boolean;
  id?: string;
}

export interface SalemYou {
  seat: number;
  hand: SalemCard[] | string[];
  tryals: SalemTryalPrivate[];
  is_witch: boolean;
  ever_witch?: boolean;
  is_constable: boolean;
  teammates?: number[];
  my_kill?: number | null;
  my_protect?: number | null;
  my_cat?: number | null;
  my_night_kill?: number | null;
  my_gavel?: number | null;
  my_conspiracy_pick?: number | null;
  can_draw?: boolean;
  can_play?: boolean;
  can_confess?: boolean;
  alive?: boolean;
}

export interface SalemResult {
  winner?: SalemWinner;
  winner_role?: string;
  winner_seats: number[];
  ever_witch?: number[];
  roles?: Record<string, string>;
  reason?: string;
}

export interface SalemState {
  phase: SalemPhase;
  round: number;
  current_seat: number | null;
  deck_count: number;
  deck_left?: number;
  alive: Record<string, boolean> | number[];
  last_night: { killed: number | null } | null;
  last_reveal?: { seat: number; index: number; id: string } | null;
  players: SalemPlayerPublic[];
  log: Record<string, unknown>[];
  result?: SalemResult | null;
  you: SalemYou | null;
  confess_seat?: number | null;
  confess_deadline?: number | null;
  deadline?: number | null;
  black_cat?: number | null;
  night_target?: number | null;
  town_hall?: Record<string, TownHall | { id: string; name: string } | string>;
  marks?: Record<string, number>;
  tryals?: Record<string, { revealed: string[]; facedown: number } | unknown>;
  blues?: Record<string, string[] | BlueAttachment[]>;
  discard_top?: string | null;
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
export const ACCUSATION_THRESHOLD = 7;

export function isSeatAlive(state: SalemState | null, seat: number): boolean {
  if (!state) return true;
  const a = state.alive;
  if (Array.isArray(a)) {
    if (a.length === 0) return true;
    return a.map(Number).includes(seat);
  }
  if (a && typeof a === "object") {
    const v = (a as Record<string, boolean>)[String(seat)];
    if (typeof v === "boolean") return v;
  }
  if (state.you && state.you.seat === seat && typeof state.you.alive === "boolean") {
    return state.you.alive;
  }
  return true;
}

export function townHallOf(state: SalemState | null, seat: number): TownHall | null {
  if (!state) return null;
  const bag = state.town_hall;
  if (bag && typeof bag === "object") {
    const raw = bag[String(seat)];
    const h = hallFrom(raw);
    if (h) return h;
  }
  const p = publicPlayer(state, seat);
  if (!p || p.town_hall == null) return null;
  if (typeof p.town_hall === "string") return { id: p.town_hall, label: p.town_hall, name: p.town_hall };
  return {
    id: p.town_hall.id,
    label: p.town_hall.label || p.town_hall.name || p.town_hall.id,
    name: p.town_hall.name || p.town_hall.label,
  };
}

export function bluesOf(state: SalemState | null, seat: number): string[] {
  if (!state) return [];
  const raw = state.blues?.[String(seat)];
  if (Array.isArray(raw)) {
    return raw.map((item) => (typeof item === "string" ? item : item.id));
  }
  return (publicPlayer(state, seat)?.blue_cards ?? []).map((c) => c.id);
}

export function marksOf(state: SalemState | null, seat: number): number {
  if (!state) return 0;
  if (state.marks && typeof state.marks[String(seat)] === "number") {
    return Number(state.marks[String(seat)]);
  }
  return publicPlayer(state, seat)?.accusations ?? 0;
}

export function publicTryalsOf(
  state: SalemState | null,
  seat: number
): { total: number; revealed: { id: string; kind?: TryalKind }[] } {
  if (!state) return { total: 0, revealed: [] };
  const raw = state.tryals?.[String(seat)] as { revealed?: string[]; facedown?: number } | undefined;
  if (raw && (raw.revealed || raw.facedown)) {
    const revealed = (raw.revealed ?? []).map((id) => ({ id, kind: tryalKindFromId(id) }));
    return { total: revealed.length + (raw.facedown ?? 0), revealed };
  }
  const p = publicPlayer(state, seat);
  if (!p) return { total: 0, revealed: [] };
  return {
    total: p.tryal_count,
    revealed: p.revealed_tryals.map((t) => ({ id: t.id ?? t.kind, kind: t.kind })),
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
    return nested as SalemState;
  }
  if ("phase" in p && ("you" in p || "players" in p || "deck_count" in p || "deck_left" in p || "marks" in p)) {
    return p as unknown as SalemState;
  }
  return null;
}

export function publicPlayer(state: SalemState | null, seat: number): SalemPlayerPublic | undefined {
  return state?.players.find((p) => p.seat === seat);
}

export function tryalKindFromId(id: string): TryalKind {
  const k = id.toLowerCase();
  if (k.includes("witch")) return "witch";
  if (k.includes("constable")) return "constable";
  return "town";
}

export function leftSeat(seat: number, n: number): number {
  const m = Math.max(n, 1);
  return (seat - 1 + m) % m;
}

export function tablePhase(phase: SalemPhase | null): "dawn" | "turn" | "night" | "confess" | "over" | null {
  if (!phase) return null;
  if (phase === "day" || phase === "conspiracy") return "turn";
  if (phase === "dawn" || phase === "turn" || phase === "night" || phase === "confess" || phase === "over") {
    return phase;
  }
  return "turn";
}

function hallFrom(raw: unknown): TownHall | null {
  if (raw == null) return null;
  if (typeof raw === "string") return { id: raw, label: raw };
  if (typeof raw === "object") {
    const o = raw as { id?: string; name?: string; label?: string };
    const id = String(o.id ?? o.name ?? "");
    return { id, label: String(o.label ?? o.name ?? id) };
  }
  return null;
}

function bluesOf(raw: unknown): BlueAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (typeof item === "string") return { id: item, label: item };
    const o = item as { id?: string; label?: string };
    return { id: String(o.id ?? ""), label: String(o.label ?? o.id ?? "") };
  });
}

function publicFromEngine(state: SalemState, seat: number): SalemPlayerPublic {
  const thBag = state.town_hall ?? {};
  const marks = state.marks ?? {};
  const tryals = state.tryals ?? {};
  const blues = state.blues ?? {};
  const rawT = tryals[String(seat)] as { revealed?: string[]; facedown?: number } | undefined;
  const revealedIds = rawT?.revealed ?? [];
  const facedown = rawT?.facedown ?? 0;
  const existing = state.players?.find((p) => p.seat === seat);
  if (existing && !state.marks) return existing;
  return {
    seat,
    town_hall: hallFrom(thBag[String(seat)]) ?? existing?.town_hall ?? null,
    accusations: Number(marks[String(seat)] ?? existing?.accusations ?? 0),
    blue_cards: bluesOf(blues[String(seat)]).length
      ? bluesOf(blues[String(seat)])
      : existing?.blue_cards ?? [],
    tryal_count: revealedIds.length + facedown || existing?.tryal_count || 0,
    revealed_tryals: revealedIds.length
      ? revealedIds.map((id, i) => ({ kind: tryalKindFromId(id), index: i, id }))
      : existing?.revealed_tryals ?? [],
  };
}

function youFromEngine(you: SalemYou | null, currentSeat: number | null, phase: SalemPhase): SalemYou | null {
  if (!you) return null;
  const tryals = (you.tryals ?? []).map((tr, i) => ({
    index: typeof tr.index === "number" ? tr.index : i,
    kind: tr.kind || tryalKindFromId(String(tr.id ?? "town")),
    revealed: Boolean(tr.revealed),
    id: tr.id,
  }));
  const isTurn = (phase === "day" || phase === "turn") && currentSeat === you.seat && you.alive !== false;
  return {
    ...you,
    tryals,
    my_kill: you.my_night_kill ?? you.my_kill ?? null,
    my_protect: you.my_gavel ?? you.my_protect ?? null,
    can_play: you.can_play ?? isTurn,
    can_draw: you.can_draw ?? false,
    can_confess: you.can_confess ?? phase === "confess",
    alive: you.alive !== false,
  };
}

/** Normalize engine visible_state into the shape SalemTable already consumes. */
export function adaptEngineState(raw: SalemState, roster: PlayerInfo[]): SalemState {
  const seats = roster.length
    ? roster.map((p) => p.seat)
    : Object.keys(raw.alive && !Array.isArray(raw.alive) ? raw.alive : {}).map(Number);
  const players = seats.map((seat) => publicFromEngine(raw, seat));
  const catSeat = players.find((p) =>
    p.blue_cards.some((c) => /cat/i.test(c.id) || /cat/i.test(c.label))
  )?.seat;
  const result = raw.result
    ? {
        ...raw.result,
        winner:
          raw.result.winner ??
          (raw.result.winner_role === "witches" || raw.result.winner_role === "witches_won"
            ? "witches"
            : "town"),
        ever_witch:
          raw.result.ever_witch ??
          (raw.result.roles
            ? Object.entries(raw.result.roles)
                .filter(([, r]) => r === "witch" || r === "witches")
                .map(([s]) => Number(s))
            : []),
      }
    : raw.result;
  return {
    ...raw,
    phase: raw.phase,
    deck_count: raw.deck_count ?? raw.deck_left ?? 0,
    players,
    log: raw.log ?? [],
    black_cat: raw.black_cat ?? catSeat ?? null,
    you: youFromEngine(raw.you, raw.current_seat, raw.phase),
    result,
  };
}

export function unrevealedTryalIndexes(p: SalemPlayerPublic | undefined): number[] {
  if (!p) return [];
  const revealed = new Set(
    p.revealed_tryals
      .map((t) => (typeof t.index === "number" ? t.index : -1))
      .filter((i) => i >= 0)
  );
  if (revealed.size === 0 && p.revealed_tryals.length) {
    const out: number[] = [];
    for (let i = p.revealed_tryals.length; i < p.tryal_count; i++) out.push(i);
    return out;
  }
  const out: number[] = [];
  for (let i = 0; i < p.tryal_count; i++) {
    if (!revealed.has(i)) out.push(i);
  }
  return out;
}
