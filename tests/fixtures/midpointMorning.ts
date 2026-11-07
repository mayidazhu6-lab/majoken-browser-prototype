import { createGame, dispatch } from "../../src/domain/reducer";
import { simulationAction } from "../../src/domain/simulation";
import { V20_RULES_VERSION } from "../../src/domain/config";
import type { Action, GameState, Setup } from "../../src/domain/types";
import fixture from "./v203-late-duel.json" with { type: "json" };

/** Legal replay boundaries; no synthetic edits to day, AP, RNG or save format. */
export function midpointMorningStates(version = V20_RULES_VERSION) {
  let state = createGame(fixture.setup as Setup, version);
  let day4Morning: GameState | undefined,
    day4Ho: GameState | undefined,
    day5Morning: GameState | undefined;
  for (const action of fixture.actionsBeforeWin as Action[]) {
    const previous = state;
    state = dispatch(state, action);
    if (previous.day === 3 && state.day === 4) day4Morning = state;
    if (previous.day === 4 && state.day === 5) {
      day4Ho = previous;
      day5Morning = state;
      break;
    }
  }
  if (!day4Morning || !day4Ho || !day5Morning)
    throw Error("Missing morning replay boundary");
  return { day4Morning, day4Ho, day5Morning };
}
export function sixthMorning() {
  let state = midpointMorningStates().day5Morning;
  for (let i = 0; i < 200 && !state.result && state.day < 6; i++)
    state = dispatch(state, simulationAction(state));
  if (state.day !== 6) throw Error("Missing sixth morning");
  return state;
}
