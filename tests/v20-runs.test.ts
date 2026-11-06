import { expect, it } from "vitest";
import { V20_RULES_VERSION } from "../src/domain/config";
import { deserialize, serialize } from "../src/domain/persistence";
import { createGame, dispatch } from "../src/domain/reducer";
import type { Action, Setup } from "../src/domain/types";
import runs from "./fixtures/v20-runs.json" with { type: "json" };

for (const run of runs) {
  it(`固定シードと操作列で ${run.result.reason} を再現する（${run.setup.seed}）`, () => {
    let s = createGame(run.setup as Setup, V20_RULES_VERSION);
    for (const [index, action] of run.actions.entries()) {
      s = dispatch(s, action as Action);
      if (index === Math.floor(run.actions.length / 2))
        s = deserialize(serialize(s));
    }
    const events = s.logs.filter((l) => l.type === "eventResult");
    expect(
      events.map((l) => ({
        day: l.day,
        event: l.data?.event,
        success: l.data?.success,
      })),
    ).toEqual(run.outcomes);
    expect(s.result).toEqual(run.result);
    expect(s.phase).toBe("ended");
    expect(deserialize(serialize(s))).toEqual(s);
    if (s.result?.reason === "completed") {
      expect(s.day).toBe(8);
      expect(s.failed).toBe(2);
      expect(s.players.every((p) => p.dailyHistory.length === 8)).toBe(true);
      expect(s.finalComparison).toHaveLength(4);
    } else {
      expect(s.failed).toBe(3);
      const today = s.logs.filter((l) => l.day === s.day);
      const finalEvent = today.find((l) => l.type === "eventResult")!;
      const reservations = today.filter((l) => l.type === "reserve");
      expect(reservations.length).toBeGreaterThan(0);
      expect(s.event.reservations).toEqual([]);
      expect(
        s.players.flatMap((p) => p.inventory).some((i) => i.lock === "event"),
      ).toBe(false);
      expect(
        today.filter((l) => l.seq > finalEvent.seq).map((l) => l.type),
      ).toEqual(["dailyHOSkipped", "end", "eventAck"]);
      expect(
        s.players.every(
          (p) => !p.night && p.dailyHistory.every((h) => h.day !== s.day),
        ),
      ).toBe(true);
      expect(s.finalComparison).toBeUndefined();
    }
  });
}
