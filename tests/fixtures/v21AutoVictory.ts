import { createGame, dispatch } from "../../src/domain/reducer";
import { simulationAction } from "../../src/domain/simulation";
import { V21_RULES_VERSION } from "../../src/domain/config";
import type { Action, GameState } from "../../src/domain/types";

export type AutoRole = "attacker" | "resting" | "third";
const seeds: Record<AutoRole, string> = {
  attacker: "auto-ho-297",
  resting: "auto-ho-0",
  third: "auto-ho-1",
};
/** Real action sequences only: no state injection, so strict save replay is meaningful. */
export function autoVictoryFixture(role: AutoRole) {
  let s = createGame(
    {
      name: "アリア",
      seed: seeds[role],
      magic: "barrier",
      stats: { attack: 3, defense: 3, insight: 3 },
    },
    V21_RULES_VERSION,
  );
  let before: GameState | undefined;
  let found = false;
  for (let i = 0; i < 400 && !s.result; i++) {
    if (found && s.phase === "ho") return { before: before!, after: s };
    let action: Action =
      s.phase === "night" && !s.players[0].night
        ? {
            type: "night",
            player: 0,
            choice: {
              kind:
                role === "attacker"
                  ? s.players[0].lastRaid === s.day - 1
                    ? "guard"
                    : "raid"
                  : role === "resting"
                    ? "rest"
                    : "guard",
              ...(role === "attacker" ? { target: 2 } : {}),
              recipes: [],
            },
          }
        : simulationAction(s);
    if (action.type === "advance") action = { ...action, pauseAtDawn: true };
    if (s.phase === "night" && action.type === "advance") before = s;
    s = dispatch(s, action);
    found ||= s.logs.some(
      (l) =>
        l.type === "win" &&
        l.data?.automatic === true &&
        (role === "attacker"
          ? l.actor === 0 && l.target === 2
          : role === "resting"
            ? l.target === 0
            : l.actor !== 0 && l.target !== 0),
    );
  }
  throw Error(`No automatic victory fixture for ${role}`);
}
