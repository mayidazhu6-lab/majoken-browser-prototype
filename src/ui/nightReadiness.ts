import type { GameState } from "../domain/types";

/** Confirmation flags only; never expose opponents' selected actions or recipes. */
export function nightReadiness(s: GameState, saving = false) {
  const confirmations = s.players.map((p) => ({
    id: p.id,
    name: p.name,
    confirmed: !!p.night,
  }));
  const selfConfirmed = !!s.players[0].night;
  const allConfirmed = confirmations.every((p) => p.confirmed);
  return {
    confirmations,
    selfConfirmed,
    allConfirmed,
    canResolve:
      s.phase === "night" &&
      selfConfirmed &&
      allConfirmed &&
      !saving &&
      !s.combat &&
      !s.challenge &&
      !s.players.some((p) => p.pendingRecipe),
  };
}
