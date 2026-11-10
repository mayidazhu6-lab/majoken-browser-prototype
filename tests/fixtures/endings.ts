import { createGame, dispatch } from "../../src/domain/reducer";
import { simulationAction } from "../../src/domain/simulation";
import { day8Setup } from "./v21Day8";
export function completedFixture(version = "browser-2.1") {
  for (const seed of [day8Setup.seed, "witches-2026", "moon-42", "review-1"]) {
    let s = createGame({ ...day8Setup, name: "結果確認", seed }, version);
    for (let i = 0; i < 1500 && !s.result; i++)
      s = dispatch(s, simulationAction(s));
    if (s.result?.reason === "completed") return s;
  }
  throw Error("Expected a legal completed fixture");
}
export function collapseFixture() {
  let s = createGame(
    { ...day8Setup, name: "崩壊確認", seed: "collapse-end-0" },
    "browser-2.1",
  );
  for (let i = 0; i < 1500 && !s.result; i++) {
    let a = simulationAction(s);
    if (
      s.phase === "public" &&
      ["gather", "research", "reserve", "duel"].includes(a.type)
    )
      a = { type: "endTurn", player: 0 };
    s = dispatch(s, a);
  }
  if (s.result?.reason !== "collapse" || s.event.acknowledged)
    throw Error("Expected pending third failure confirmation");
  return s;
}
