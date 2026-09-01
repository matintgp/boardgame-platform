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

export type SalemPhase = "day" | "town_hall" | "conspiracy" | "night" | "confess" | "over";
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
  /** Engine slot indexes still facedown (public; no hidden ids). */
  unrevealed?: number[];
  /** Engine slot indexes already showing, when known. */
  revealed_indexes?: number[];
}

export interface SalemYouTryal {
  id: string;
  revealed: boolean;
  index?: number;
  kind?: TryalKind;
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
  can_play?: boolean;
  can_draw?: boolean;
  can_confess?: boolean;
  my_kill?: number | null;
  my_protect?: number | null;
  town_hall_options?: SalemTownHall[];
}

export interface SalemResult {
  reason?: string;
  winner?: SalemWinner;
  winner_role: SalemWinner;
  ever_witch?: number[];
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
  deck_count?: number;
  log?: Record<string, unknown>[];
  players?: { seat: number }[];
  black_cat?: number | null;
  discard_top?: string | null;
  last_night: { killed: number | null } | null;
  last_reveal?: { seat: number; index: number; id: string } | null;
  confess_deadline: number | null;
  result?: SalemResult | null;
  current_seat: number | null;
  you: SalemYou | null;
  deadline?: number | null;
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
  created_by?: string;
  created_at?: string | number | null;
  expires_at?: string | number | null;
  state?: SalemState;
}

export const SALEM_MIN_PLAYERS = 4;
export const SALEM_MAX_FALLBACK = 12;
export const MARK_THRESHOLD = 7;
export const ACCUSATION_THRESHOLD = MARK_THRESHOLD;

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
  const row = state.tryals[String(seat)] as SalemPublicTryals & {
    revealed?: unknown;
    unrevealed?: unknown;
    revealed_indexes?: unknown;
  };
  if (!row || typeof row !== "object") return empty;
  const revealed: string[] = [];
  const revealed_indexes: number[] = [];
  if (Array.isArray(row.revealed)) {
    for (const item of row.revealed) {
      if (item && typeof item === "object") {
        const o = item as { id?: string; index?: number };
        revealed.push(String(o.id ?? ""));
        if (typeof o.index === "number" && Number.isFinite(o.index)) revealed_indexes.push(o.index);
      } else {
        revealed.push(String(item));
      }
    }
  }
  const extraIdx = Array.isArray(row.revealed_indexes)
    ? row.revealed_indexes.map(Number).filter((n) => Number.isFinite(n))
    : [];
  const unrevealed = Array.isArray(row.unrevealed)
    ? row.unrevealed.map(Number).filter((n) => Number.isFinite(n))
    : undefined;
  return {
    revealed,
    facedown: typeof row.facedown === "number" ? row.facedown : 0,
    unrevealed,
    revealed_indexes: revealed_indexes.length ? revealed_indexes : extraIdx.length ? extraIdx : undefined,
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
      return {
        id,
        revealed: Boolean(o.revealed),
        index: typeof (o as { index?: number }).index === "number" ? (o as { index?: number }).index : undefined,
        kind: o.kind === "witch" || o.kind === "constable" || o.kind === "innocent" ? (o.kind as TryalKind) : undefined,
      };
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
    town_hall_options: Array.isArray(y.town_hall_options)
      ? y.town_hall_options
          .map((raw) => {
            if (raw && typeof raw === "object") {
              const o = raw as { id?: string; name?: string };
              if (!o.id) return null;
              return { id: String(o.id), name: String(o.name || o.id) };
            }
            if (typeof raw === "string") return { id: raw, name: raw };
            return null;
          })
          .filter((x): x is SalemTownHall => x != null)
      : [],
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

/**
 * Facedown engine slot indexes for a public tryal row.
 * Prefer engine `unrevealed` / per-card indexes; otherwise punch holes from
 * known revealed slots (last_reveal). Prefix-only when nothing else is known.
 */
export function unrevealedPublicIndexes(
  row: SalemPublicTryals,
  knownRevealedIndexes?: readonly number[] | null
): number[] {
  const total = row.revealed.length + row.facedown;
  if (total <= 0) return [];
  if (Array.isArray(row.unrevealed) && row.unrevealed.length === row.facedown) {
    return [...new Set(row.unrevealed.filter((i) => i >= 0 && i < total))].sort((a, b) => a - b);
  }
  const known = new Set<number>();
  for (const i of row.revealed_indexes ?? []) known.add(i);
  for (const i of knownRevealedIndexes ?? []) known.add(i);
  const valid = [...known].filter((i) => i >= 0 && i < total);
  if (row.revealed.length === 0) {
    return Array.from({ length: row.facedown }, (_, i) => i);
  }
  if (valid.length === row.revealed.length) {
    return Array.from({ length: total }, (_, i) => i).filter((i) => !known.has(i));
  }
  const start = row.revealed.length;
  return Array.from({ length: row.facedown }, (_, i) => start + i);
}


export function publicTryalsOf(
  state: SalemState | null,
  seat: number
): { total: number; revealed: { id: string; index?: number }[] } {
  const row = tryalsOf(state, seat);
  return {
    total: row.revealed.length + row.facedown,
    revealed: row.revealed.map((id, i) => ({ id, index: i })),
  };
}

export function publicPlayer(state: SalemState | null, seat: number) {
  return state?.players?.find((p) => p.seat === seat);
}

export function unrevealedTryalIndexes(stateOrRow: SalemState | { revealed: string[]; facedown: number } | undefined, seat?: number): number[] {
  if (!stateOrRow) return [];
  if (seat != null && "tryals" in (stateOrRow as SalemState)) {
    return unrevealedPublicIndexes(tryalsOf(stateOrRow as SalemState, seat));
  }
  if ("revealed" in stateOrRow && "facedown" in stateOrRow) {
    return unrevealedPublicIndexes(stateOrRow as SalemPublicTryals);
  }
  return [];
}

export function adaptEngineState(raw: SalemState, _roster?: PlayerInfo[]): SalemState {
  const you = raw.you
    ? {
        ...raw.you,
        can_play: raw.phase === "day" && raw.current_seat === raw.you.seat && raw.you.alive,
        my_kill: raw.you.my_night_kill ?? raw.you.my_kill ?? null,
        my_protect: raw.you.my_gavel ?? raw.you.my_protect ?? null,
        tryals: raw.you.tryals.map((tr, i) => ({
          ...tr,
          index: tr.index ?? i,
          kind:
            tr.kind ??
            (tr.id.includes("witch")
              ? "witch"
              : tr.id.includes("constable")
                ? "constable"
                : "innocent"),
        })),
      }
    : null;
  return {
    ...raw,
    deck_count: raw.deck_count ?? raw.deck_left,
    log: raw.log ?? [],
    you,
    result: raw.result
      ? {
          ...raw.result,
          winner: raw.result.winner ?? raw.result.winner_role,
          ever_witch:
            raw.result.ever_witch ??
            (raw.result.roles
              ? Object.entries(raw.result.roles)
                  .filter(([, r]) => r === "witch" || r === "witches")
                  .map(([s]) => Number(s))
              : []),
        }
      : raw.result,
  };
}

export type EnginePhase = SalemPhase;

export function unrevealedIndexes(state: SalemState | null, seat: number): number[] {
  return unrevealedPublicIndexes(tryalsOf(state, seat));
}
