/** Original Town Hall / card ids matching salem_data.py. Engine labels win when present. */

import type { CardColor, SalemCard } from "./types";

export const TOWN_HALL_IDS = [
  "stern_accuser",
  "iron_will",
  "sealed_row",
  "card_cache",
  "crowd_voice",
  "steady_hand",
  "closed_purse",
  "hex_ward",
  "first_light",
  "last_word",
  "town_crier",
  "marked_stranger",
  "village_healer",
  "watch_ally",
  "kiln_guard",
  "quiet_bench",
] as const;

export type TownHallId = (typeof TOWN_HALL_IDS)[number];

export const RED_MARKS: Record<string, number> = {
  accusation: 1,
  evidence: 2,
  witness: 3,
};

export const RED_CARDS = new Set(Object.keys(RED_MARKS));
export const GREEN_CARDS = new Set(["alibi", "arson", "robbery", "scapegoat", "stocks", "curse"]);
export const BLUE_CARDS = new Set(["black_cat"]);
export const BLACK_CARDS = new Set(["conspiracy", "night"]);
export const ALL_PLAY_CARDS = new Set([...RED_CARDS, ...GREEN_CARDS, ...BLUE_CARDS, ...BLACK_CARDS]);

export function townHallI18nKey(id: string): string {
  const k = id.toLowerCase().replace(/[^a-z_]/g, "");
  if ((TOWN_HALL_IDS as readonly string[]).includes(k)) return k;
  return "unknownHall";
}

export function cardI18nKey(id: string): string | null {
  const k = id.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (ALL_PLAY_CARDS.has(k)) return k;
  if (k === "blackcat") return "black_cat";
  if (k === "nightfall") return "night";
  return null;
}

export function cardColor(id: string): CardColor {
  const k = id.toLowerCase();
  if (RED_CARDS.has(k)) return "red";
  if (GREEN_CARDS.has(k)) return "green";
  if (BLUE_CARDS.has(k)) return "blue";
  return "black";
}

export function cardNeedsTargets(card: SalemCard | string): 0 | 1 | 2 {
  const id = typeof card === "string" ? card : card.id;
  if (RED_CARDS.has(id) || GREEN_CARDS.has(id) || BLUE_CARDS.has(id)) return 1;
  return 0;
}

export function cardNeedsTryal(card: SalemCard | string): boolean {
  const id = typeof card === "string" ? card : card.id;
  return RED_CARDS.has(id) || id === "scapegoat";
}

export function accusationValue(card: SalemCard | string): number {
  const id = typeof card === "string" ? card : card.id;
  return RED_MARKS[id] ?? 0;
}

export function cardFromId(id: string, title?: string, text?: string): SalemCard {
  return {
    id,
    color: cardColor(id),
    title: title ?? id,
    text: text ?? "",
  };
}

export function tryalKind(id: string): import("./types").TryalKind {
  const k = id.toLowerCase();
  if (k.includes("witch")) return "witch";
  if (k.includes("constable")) return "constable";
  return "town";
}
