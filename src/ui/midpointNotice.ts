import type { GameState } from "../domain/types";
import { publicDuelReward } from "../domain/publicDuelReward";

/** Existing morning confirmation date is the only display history used. */
export function midpointNotice(state: GameState, confirmedDay: number) {
  if (
    state.day !== 5 ||
    state.phase !== "public" ||
    confirmedDay !== 4 ||
    state.publicTurn.round !== 1 ||
    state.publicTurn.acted ||
    state.combat ||
    state.challenge
  )
    return undefined;
  // Do not replay the announcement on a resumed, already-started fifth day.
  if (
    state.logs.some(
      (log) =>
        log.day === 5 &&
        log.phase === "public" &&
        log.actor === 0 &&
        [
          "gather",
          "research",
          "shop",
          "reserve",
          "withdraw",
          "trade",
          "tradeRejected",
          "usePotion",
          "forced",
          "combatStart",
          "turnEnd",
        ].includes(log.type),
    )
  )
    return undefined;
  const early = publicDuelReward({ rulesVersion: state.rulesVersion, day: 4 });
  const late = publicDuelReward({ rulesVersion: state.rulesVersion, day: 5 });
  return late > early ? { early, late } : undefined;
}
