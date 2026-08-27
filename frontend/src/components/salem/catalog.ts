/** Engine card / Town Hall / tryal ids from salem_data.py. Map ids → color/title. */

import type { CardColor, TryalKind } from "./types";

export const TRYAL_INNOCENT = "tryal_innocent";
export const TRYAL_WITCH = "tryal_witch";
export const TRYAL_CONSTABLE = "tryal_constable";

export const RED_CARDS = ["accusation", "evidence", "witness"] as const;
export const GREEN_CARDS = ["alibi", "arson", "robbery", "scapegoat", "stocks", "curse"] as const;
export const BLUE_CARDS = ["black_cat"] as const;
export const BLACK_CARDS = ["conspiracy", "night"] as const;

const TARGET_CARDS = new Set<string>([...RED_CARDS, ...GREEN_CARDS, ...BLUE_CARDS]);
const NO_SELF_CARDS = new Set<string>(["robbery", "stocks"]);

export interface PlayCardInfo {
  id: string;
  color: CardColor;
  title: string;
  text: string;
}

export const CARD_CATALOG: Record<string, Omit<PlayCardInfo, "id">> = {
  accusation: { color: "red", title: "Writ", text: "+1 wax seal." },
  evidence: { color: "red", title: "Proof", text: "+2 wax seals." },
  witness: { color: "red", title: "Oath", text: "+3 wax seals." },
  alibi: { color: "green", title: "Clean Hands", text: "Wipe a player's seals." },
  arson: { color: "green", title: "Hearthfire", text: "Burn a Night Familiar." },
  robbery: { color: "green", title: "Cutpurse", text: "Steal a random card. Not self." },
  scapegoat: { color: "green", title: "Shifted Blame", text: "Move seals onto another player." },
  stocks: { color: "green", title: "Pillory", text: "They skip their next turn. Not self." },
  curse: { color: "green", title: "Hex", text: "They discard a random card." },
  black_cat: { color: "blue", title: "Night Familiar", text: "A lasting hex. The Turning peeks." },
  conspiracy: { color: "black", title: "The Turning", text: "Each living player passes a sealed trial." },
  night: { color: "black", title: "Nightfall", text: "Night falls." },
};

export const TOWN_HALL_NAMES: Record<string, string> = {
  stern_accuser: "Stern Accuser",
  iron_will: "Iron Will",
  sealed_row: "Sealed Row",
  card_cache: "Card Cache",
  crowd_voice: "Crowd Voice",
  steady_hand: "Steady Hand",
  closed_purse: "Closed Purse",
  hex_ward: "Hex Ward",
  first_light: "First Light",
  last_word: "Last Word",
  town_crier: "Town Crier",
  marked_stranger: "Marked Stranger",
  village_healer: "Village Healer",
  watch_ally: "Watch Ally",
  kiln_guard: "Kiln Guard",
  quiet_bench: "Quiet Bench",
};

export function playCardInfo(id: string): PlayCardInfo {
  const meta = CARD_CATALOG[id];
  if (meta) return { id, ...meta };
  return { id, color: "green", title: id, text: "" };
}

export function cardNeedsTarget(id: string): boolean {
  return TARGET_CARDS.has(id);
}

export function cardForbidsSelf(id: string): boolean {
  return NO_SELF_CARDS.has(id);
}

export function tryalKindFromId(id: string): TryalKind {
  if (id === TRYAL_WITCH) return "witch";
  if (id === TRYAL_CONSTABLE) return "constable";
  return "innocent";
}

export function tryalFace(id: string): "witch" | "not-witch" | "constable" {
  if (id === TRYAL_WITCH) return "witch";
  if (id === TRYAL_CONSTABLE) return "constable";
  return "not-witch";
}

export function townHallName(id: string, fallback?: string): string {
  return TOWN_HALL_NAMES[id] ?? fallback ?? id;
}

export function cardI18nKey(id: string): string | null {
  const k = id.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (k in CARD_CATALOG) return k;
  if (k === "blackcat") return "black_cat";
  return null;
}

export function townHallI18nKey(id: string): string {
  const k = id.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (k in TOWN_HALL_NAMES) return k;
  return "unknownHall";
}

export function cardMeta(id: string): {
  id: string;
  color: CardColor;
  marks?: number;
  needsTarget: boolean;
  allowSelf?: boolean;
  needsFromSeat?: boolean;
  needsTryalOnThreshold?: boolean;
} {
  return {
    id,
    color: cardColor(id),
    marks: RED_MARKS[id],
    needsTarget: cardNeedsTargets(id) > 0,
    allowSelf: id === "alibi",
    needsFromSeat: id === "scapegoat",
    needsTryalOnThreshold: (RED_CARDS as readonly string[]).includes(id) || id === "scapegoat",
  };
}

export const RED_MARKS: Record<string, number> = {
  accusation: 1,
  evidence: 2,
  witness: 3,
};

export function cardColor(id: string): CardColor {
  if ((RED_CARDS as readonly string[]).includes(id)) return "red";
  if ((GREEN_CARDS as readonly string[]).includes(id)) return "green";
  if ((BLUE_CARDS as readonly string[]).includes(id)) return "blue";
  return "black";
}

export function cardNeedsTargets(card: { id: string } | string): 0 | 1 {
  const id = typeof card === "string" ? card : card.id;
  return TARGET_CARDS.has(id) ? 1 : 0;
}

export function accusationValue(card: { id: string } | string): number {
  const id = typeof card === "string" ? card : card.id;
  return RED_MARKS[id] ?? 0;
}

export function cardFromId(id: string, title?: string, text?: string) {
  const info = playCardInfo(id);
  return { id, color: info.color, title: title ?? info.title, text: text ?? info.text };
}

export function tryalKind(id: string): "witch" | "town" | "constable" {
  const k = tryalKindFromId(id);
  return k === "innocent" ? "town" : k;
}
