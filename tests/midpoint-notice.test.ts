import { expect, it } from "vitest";
import { midpointNotice } from "../src/ui/midpointNotice";
import { publicDuelReward } from "../src/domain/publicDuelReward";
import { V20_NPC_RULES_VERSION } from "../src/domain/config";
import { dispatch } from "../src/domain/reducer";
import { simulationAction } from "../src/domain/simulation";
import { serialize, deserialize } from "../src/domain/persistence";
import {
  midpointMorningStates,
  sixthMorning,
} from "./fixtures/midpointMorning";
const { day4Morning, day4Ho, day5Morning } = midpointMorningStates();
it("uses the existing reward implementation and leaves the game state untouched", () => {
  const before = serialize(day5Morning);
  expect(midpointNotice(day5Morning, 4)).toEqual({
    early: publicDuelReward({ ...day5Morning, day: 4 }),
    late: publicDuelReward(day5Morning),
  });
  expect(midpointNotice(day5Morning, 4)).toEqual({ early: 1, late: 2 });
  expect(serialize(day5Morning)).toBe(before);
  expect(serialize(deserialize(before))).toBe(before);
});
it.each([0, 5, 6])(
  "does not force the notice with missing/already confirmed day %s",
  (day) => expect(midpointNotice(day5Morning, day)).toBeUndefined(),
);
it("is absent on the fourth day and sixth day, and during dawn judgement", () => {
  expect(midpointNotice(day4Morning, 3)).toBeUndefined();
  expect(midpointNotice(day4Ho, 4)).toBeUndefined();
  expect(midpointNotice(sixthMorning(), 5)).toBeUndefined();
});
it("keeps historical +1FP saves out of the reward-up announcement", () => {
  const old = midpointMorningStates(V20_NPC_RULES_VERSION).day5Morning;
  expect(publicDuelReward(old)).toBe(1);
  expect(midpointNotice(old, 4)).toBeUndefined();
});
it("does not force a notice after either a free operation or an AP action", () => {
  expect(
    midpointNotice(dispatch(day5Morning, { type: "withdraw", player: 0 }), 4),
  ).toBeUndefined();
  const acted = dispatch(day5Morning, simulationAction(day5Morning));
  expect(midpointNotice(acted, 4)).toBeUndefined();
});
