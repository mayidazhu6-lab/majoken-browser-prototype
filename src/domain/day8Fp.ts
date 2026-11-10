import { V21_RULES_VERSION } from "./config";
import type { Day8FpChange, FpChangeContext, GameState, Player } from "./types";

/** Called only at the actual transition into day 8, never from load or display. */
export function beginDay8Fp(s: GameState) {
  if (
    s.rulesVersion !== V21_RULES_VERSION ||
    s.day !== 8 ||
    s.result ||
    s.day8Fp
  )
    return;
  s.day8Fp = {
    day: 8,
    start: s.players.map((p) => ({ player: p.id, fp: p.fp })),
    entries: [],
  };
}

/** Receives the clamped, already-applied delta directly from the FP mutation. */
export function recordDay8Fp(
  s: GameState,
  p: Player,
  amount: number,
  reason: string,
  context: FpChangeContext,
) {
  const record = s.day8Fp;
  if (
    s.rulesVersion !== V21_RULES_VERSION ||
    s.day !== 8 ||
    s.result ||
    !record ||
    record.final ||
    amount === 0
  )
    return;
  record.entries.push({
    order: record.entries.length + 1,
    day: 8,
    player: p.id,
    amount,
    reason,
    fpAfter: p.fp,
    ...(context.relatedPlayers
      ? { relatedPlayers: [...context.relatedPlayers] }
      : {}),
    ...(context.eventId !== undefined ? { eventId: context.eventId } : {}),
  });
}

/** Normal completion and collapse freeze the actual FP without creating changes. */
export function finishDay8Fp(s: GameState) {
  if (
    s.rulesVersion === V21_RULES_VERSION &&
    s.day === 8 &&
    s.day8Fp &&
    !s.day8Fp.final
  )
    s.day8Fp.final = s.players.map((p) => ({ player: p.id, fp: p.fp }));
}

export interface Day8FpBreakdown {
  day: 8;
  players: {
    player: number;
    start: number;
    end: number;
    change: number;
    entries: Day8FpChange[];
  }[];
}

/** End-only allowlist for a future shared view. Never replays or reconstructs logs.
 * undefined = no record; an existing record with no entries = no FP changes.
 * Collapse may retain data, but does not imply a day-8 summary screen.
 */
export function day8FpBreakdown(s: GameState): Day8FpBreakdown | undefined {
  const record = s.day8Fp;
  if (
    !s.result ||
    s.phase !== "ended" ||
    s.rulesVersion !== V21_RULES_VERSION ||
    !record?.final
  )
    return;
  return {
    day: 8,
    players: record.start.map((start) => {
      const end = record.final!.find((p) => p.player === start.player)!.fp;
      return {
        player: start.player,
        start: start.fp,
        end,
        change: end - start.fp,
        entries: record.entries
          .filter((e) => e.player === start.player)
          .map((e) => ({
            order: e.order,
            day: e.day,
            player: e.player,
            amount: e.amount,
            reason: e.reason,
            fpAfter: e.fpAfter,
            ...(e.relatedPlayers
              ? { relatedPlayers: [...e.relatedPlayers] }
              : {}),
            ...(e.eventId !== undefined ? { eventId: e.eventId } : {}),
          })),
      };
    }),
  };
}
