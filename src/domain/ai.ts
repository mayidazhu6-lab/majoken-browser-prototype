import type {
  Action,
  GameState,
  Player,
  Stats,
  CurrentEvent,
  EventDefinition,
  Log,
} from "./types";
import { random } from "./rng";
import { log } from "./core";
/** AI候補は公開情報と当人の私有情報だけで作る。乱数状態は選択時にだけ更新。 */
export interface Observation {
  day: number;
  failed: number;
  event: CurrentEvent;
  eventDefinition: EventDefinition;
  self: Player;
  others: { id: number; name: string; stats: Stats; fp: number; ap: number }[];
  publicLogs: Log[];
}
export const AI_POLICY = {
  goalDuelDaily: [19, 20, 21, 24],
  goalDuelLong: [2, 5, 13, 19, 24],
  goalTradeDaily: [8, 9, 10, 23],
  goalTradeLong: [2, 7, 8, 12, 18],
  goalBrewDaily: [3, 5],
  explorationWeight: 1,
  goalWeight: 5,
  growthWeight: 3,
} as const;
export function weightedAction(
  s: GameState,
  candidates: { action: Action; weight: number; reason: string }[],
) {
  let r = random(s) * candidates.reduce((n, c) => n + c.weight, 0);
  const selected =
    candidates.find((c) => {
      r -= c.weight;
      return r < 0;
    }) ?? candidates[candidates.length - 1];
  log(s, "rng", "AI重み付き選択", {
    audience: "dev",
    data: {
      draw: s.draws,
      candidates: structuredClone(candidates),
      result: structuredClone(selected),
    },
  });
  return selected;
}
