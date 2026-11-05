import type { GameState, Item, Player } from "./types";
import { MATERIALS, level } from "./config";
export interface Recipe {
  id: string;
  name: string;
  materials: string[];
  effect:
    | "gather"
    | "research"
    | "cleanse"
    | "guard"
    | "scout"
    | "attack"
    | "defense"
    | "charge"
    | "change";
  power: number;
  tier: "normal" | "special" | "combat" | "change";
}
export const RECIPES: Recipe[] = [
  {
    id: "vigor",
    name: "活力の薬",
    materials: ["crystal"],
    effect: "gather",
    power: 1,
    tier: "normal",
  },
  {
    id: "study",
    name: "研鑽の薬",
    materials: ["obsidian"],
    effect: "research",
    power: 1,
    tier: "normal",
  },
  {
    id: "cleanse",
    name: "浄化の薬",
    materials: ["water"],
    effect: "cleanse",
    power: 1,
    tier: "normal",
  },
  {
    id: "watch",
    name: "守護の薬",
    materials: ["herb"],
    effect: "guard",
    power: 1,
    tier: "normal",
  },
  {
    id: "sight",
    name: "千里眼の薬",
    materials: ["sand"],
    effect: "scout",
    power: 2,
    tier: "normal",
  },
  {
    id: "harvest",
    name: "豊穣の薬",
    materials: ["crystal", "sand"],
    effect: "gather",
    power: 3,
    tier: "special",
  },
  {
    id: "wisdom",
    name: "叡智の薬",
    materials: ["obsidian", "crystal"],
    effect: "research",
    power: 3,
    tier: "special",
  },
  {
    id: "purify",
    name: "完全浄化の薬",
    materials: ["water", "herb"],
    effect: "cleanse",
    power: 2,
    tier: "special",
  },
  {
    id: "aegis",
    name: "堅守の薬",
    materials: ["herb", "crystal"],
    effect: "guard",
    power: 3,
    tier: "special",
  },
  {
    id: "omniscience",
    name: "万象透視の薬",
    materials: ["sand", "water"],
    effect: "scout",
    power: 999,
    tier: "special",
  },
  {
    id: "strike",
    name: "剛撃薬",
    materials: ["obsidian", "crystal"],
    effect: "attack",
    power: 4,
    tier: "combat",
  },
  {
    id: "iron",
    name: "鉄壁薬",
    materials: ["herb", "crystal"],
    effect: "defense",
    power: 4,
    tier: "combat",
  },
  {
    id: "focus",
    name: "洞察薬",
    materials: ["sand", "water"],
    effect: "charge",
    power: 4,
    tier: "combat",
  },
  {
    id: "talent",
    name: "才能変化薬",
    materials: MATERIALS.slice(0, 5),
    effect: "change",
    power: 0,
    tier: "change",
  },
];
export const recipe = (id: string) => RECIPES.find((r) => r.id === id);
export const isMaterial = (kind: string) => MATERIALS.includes(kind);
export const available = (p: Player) => p.inventory.filter((i) => !i.lock);
export function addItem(s: GameState, p: Player, kind: string): Item {
  const item = { id: s.nextItem++, kind };
  p.inventory.push(item);
  return item;
}
export function canRecipe(p: Player, id: string, day: number) {
  const r = recipe(id);
  return (
    !!r &&
    (r.tier !== "special" ||
      p.recipes.includes(id) ||
      (p.temporaryRecipe?.kind === id && p.temporaryRecipe.day === day)) &&
    (r.tier !== "combat" || level(p.stats.insight) === 3)
  );
}
export function materialIds(p: Player, kinds: readonly string[]) {
  const pool = available(p);
  const ids: number[] = [];
  for (const kind of kinds) {
    const i = pool.find((i) => i.kind === kind && !ids.includes(i.id));
    if (!i) return null;
    ids.push(i.id);
  }
  return ids;
}
export function consume(p: Player, ids: number[]) {
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !p.inventory.some((i) => i.id === id && !i.lock))
  )
    throw Error("素材不足または予約中です");
  p.inventory = p.inventory.filter((i) => !ids.includes(i.id));
}
