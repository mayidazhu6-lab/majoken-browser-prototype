import { createGame, dispatch } from "../../src/domain/reducer";
import { simulationAction } from "../../src/domain/simulation";
import { V21_RULES_VERSION } from "../../src/domain/config";
import type { Setup } from "../../src/domain/types";
export const day8Setup: Setup = {
  name: "順序確認",
  seed: "win-audit-1",
  magic: "barrier",
  stats: { attack: 3, defense: 3, insight: 3 },
};
/** Only legal actions, so both sides of the final judgment support strict replay. */
export function day8Fixture() {
  let s = createGame(day8Setup, V21_RULES_VERSION);
  for (let i = 0; i < 1500 && !s.result; i++) {
    if (s.day === 8 && s.phase === "ho")
      return {
        before: s,
        after: dispatch(s, { type: "advance", pauseAtDawn: true }),
      };
    const action = simulationAction(s);
    s = dispatch(
      s,
      action.type === "advance" ? { ...action, pauseAtDawn: true } : action,
    );
  }
  throw Error("Expected day-8 judgment");
}
