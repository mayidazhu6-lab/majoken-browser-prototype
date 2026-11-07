import { expect, it } from "vitest";
import { initialState, runAI4, extract } from "../scripts/balance/ai4";
import { createGame } from "../src/domain/reducer";
import { publicDuelReward } from "../src/domain/publicDuelReward";

it("restricts four AI seats to the harness and preserves paired setup", () => {
  const old = initialState("balance-v204-0000", "browser-2.0.3");
  const current = initialState("balance-v204-0000", "browser-2.0.4");
  expect(current.players).toEqual(old.players);
  expect(current.players.every((p) => p.ai)).toBe(true);
  expect(
    createGame(current.setup, current.rulesVersion).players.map((p) => p.ai),
  ).toEqual([false, true, true, true]);
});

it("reproduces a full AI game and reconciles final/day FP and public win rewards", () => {
  for (const version of ["browser-2.0.3", "browser-2.0.4"]) {
    const a = runAI4("balance-v204-0000", version).state;
    const b = runAI4("balance-v204-0000", version).state;
    expect(b).toEqual(a);
    const row = extract(a);
    expect(row.reason).toBe("completed");
    expect(row.fpDays[7]).toEqual(a.players.map((p) => p.fp));
    for (const p of a.players) {
      const reward = row.wins
        .filter((w) => w.player === p.id)
        .reduce(
          (n, w) => n + publicDuelReward({ day: w.day, rulesVersion: version }),
          0,
        );
      expect(
        a.logs
          .filter(
            (l) => l.type === "fp" && l.kind === "duel" && l.actor === p.id,
          )
          .reduce((n, l) => n + (l.amount ?? 0), 0),
      ).toBe(reward);
    }
    expect(row.events).toHaveLength(8);
  }
});
