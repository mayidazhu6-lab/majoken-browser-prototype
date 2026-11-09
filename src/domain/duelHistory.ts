import { V21_RULES_VERSION } from "./config";
import { log } from "./core";
import type { GameState } from "./types";

/** A read-only view: opponents identify the pair; participants receive HO credit. */
export interface DuelRecord {
  id: number;
  kind: "public" | "secret";
  opponents: [number, number];
  participants: number[];
  winner: number | null;
  hasRounds: boolean;
}

export function duelHistory(s: GameState): DuelRecord[] {
  const records: DuelRecord[] = s.combatHistory.flatMap((c) =>
    c.kind === "mock"
      ? []
      : [
          {
            id: c.id,
            kind: c.kind,
            opponents: c.participants,
            participants: c.participants,
            winner: c.winner ?? null,
            hasRounds: true,
          },
        ],
  );
  if (s.rulesVersion !== V21_RULES_VERSION) return records;
  const ids = new Set(records.map((r) => r.id));
  for (const entry of s.logs) {
    const id = entry.data?.id;
    if (
      entry.type !== "win" ||
      entry.data?.automatic !== true ||
      entry.data?.kind !== "secret" ||
      typeof id !== "number" ||
      entry.actor === undefined ||
      entry.target === undefined ||
      ids.has(id)
    )
      continue;
    ids.add(id);
    records.push({
      id,
      kind: "secret",
      opponents: [entry.actor, entry.target],
      participants: [entry.actor],
      winner: entry.actor,
      hasRounds: false,
    });
  }
  return records.sort((a, b) => a.id - b.id);
}

/** One raid per actor per night; retain that identity without new save-state fields. */
export function recordAutomaticVictory(
  s: GameState,
  [actor, target]: [number, number],
) {
  if (
    s.rulesVersion !== V21_RULES_VERSION ||
    s.logs.some(
      (l) =>
        l.day === s.day &&
        l.type === "win" &&
        l.actor === actor &&
        l.target === target &&
        l.data?.automatic === true,
    )
  )
    return;
  log(s, "win", "休息者への襲撃で自動勝利（ラウンドなし）", {
    actor,
    target,
    audience: [actor, target],
    data: {
      id: s.nextCombat++,
      kind: "secret",
      initiator: actor,
      initiated: true,
      automatic: true,
      hasRounds: false,
    },
  });
}
