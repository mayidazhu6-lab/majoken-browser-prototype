import { describe, it, expect } from "vitest";
import { createGame, dispatch } from "../src/domain/reducer";
import { startCombat, resolveRound } from "../src/domain/combat";
import {
  roundReason,
  combatReason,
  revealedActions,
} from "../src/ui/combatPresentation";
import { isMaterial } from "../src/domain/items";
import { simulationAction } from "../src/domain/simulation";
import { deserialize, serialize } from "../src/domain/persistence";
import { LEGACY_RULES_VERSION } from "../src/domain/config";
import type { Stance } from "../src/domain/types";
const setup = {
  name: "検証",
  seed: "v023",
  magic: "illusion" as const,
  stats: { attack: 4, defense: 3, insight: 3 },
};
describe("v0.2.3 stored combat presentation", () => {
  it.each(["attack", "defend", "charge"] as Stance[])(
    "explains all pairings for %s without mutating the combat",
    (a) => {
      for (const b of ["attack", "defend", "charge"] as Stance[]) {
        const s = createGame(setup),
          c = startCombat(s, 0, 1, "public");
        resolveRound(s, [a, b], [undefined, undefined]);
        const before = JSON.stringify(c);
        const text = roundReason(c.rounds[0]);
        expect(text.length).toBeGreaterThan(20);
        expect(revealedActions(c.rounds[0], ["自分", "相手"])).toContain(
          "自分",
        );
        expect(JSON.stringify(c)).toBe(before);
        if (a === "attack" && b === "charge") expect(text).toContain("無防備");
        if (a === "defend" && b === "defend")
          expect(text).toContain("ダメージはありません");
      }
    },
  );
  it("separates charge generation from consumption; five rounds end by HP", () => {
    const s = createGame(setup),
      c = startCombat(s, 0, 1, "public");
    resolveRound(s, ["charge", "defend"], [undefined, undefined]);
    const first = c.rounds[0];
    expect(first.chargeBonus[0]).toBe(0);
    expect(first.nextCharge[0]).toBeGreaterThan(0);
    resolveRound(s, ["defend", "defend"], [undefined, undefined]);
    expect(c.rounds[1].chargeBonus[0]).toBe(first.nextCharge[0]);
    while (!c.done)
      resolveRound(s, ["defend", "defend"], [undefined, undefined]);
    expect(combatReason(c)).toContain("最大5ラウンド");
    expect(combatReason(c)).toContain("引き分け");
  });
  it("reports illusion changed actions using stored original and actual choices", () => {
    const s = createGame(setup);
    s.players[0].activeMagic = true;
    const c = startCombat(s, 0, 1, "secret");
    c.illusionRound = 0;
    resolveRound(s, ["defend", "attack"], [undefined, undefined]);
    expect(revealedActions(c.rounds[0], ["自分", "相手"])).toContain(
      "幻惑で攻撃から変更",
    );
  });
});
describe("reported rules investigations (no rule changes)", () => {
  it("legacy day 1 potion delivery could be drawn, with no potion source before the public deadline", () => {
    let s = createGame(setup, LEGACY_RULES_VERSION);
    for (let n = 0; s.event.id !== 7 && n < 1000; n++)
      s = createGame(
        { ...setup, seed: `day-one-potion-${n}` },
        LEGACY_RULES_VERSION,
      );
    expect(s.event.id).toBe(7);
    expect(s.day).toBe(1);
    expect(
      s.players.every((p) => p.inventory.every((i) => isMaterial(i.kind))),
    ).toBe(true);
    expect(() =>
      dispatch(s, { type: "brew", player: 0, recipe: "vigor" }),
    ).toThrow();
    while (!s.event.resolved) s = dispatch(s, simulationAction(s));
    expect(s.event.success).toBe(false);
    expect(s.event.finalProgress?.potions).toBe(0);
  });
  it("rest does not disable defensive combat actions", () => {
    const s = createGame(setup);
    s.players[1].night = { kind: "rest" };
    s.players[1].stats.defense = 12;
    const c = startCombat(s, 0, 1, "secret");
    resolveRound(s, ["attack", "defend"], [undefined, undefined]);
    expect(c.rounds[0].counter[1]).toBe(true);
    expect(c.rounds[0].damage[1]).toBe(0);
    expect(roundReason(c.rounds[0])).toContain("カウンター");
  });
  it("v022 game saves remain replay-compatible, optional presentation ignored by domain", () => {
    let s = createGame(setup, LEGACY_RULES_VERSION);
    s = dispatch(s, simulationAction(s));
    const raw = {
      ...JSON.parse(serialize(s)),
      presentation: { version: 1, battleStep: "choose" },
    };
    expect(deserialize(JSON.stringify(raw))).toEqual(s);
  });
});

import { uiText } from "../src/ui/text";
it("normalizes persisted goal and log vocabulary only at the UI boundary", () => {
  expect(uiText("長期HO / 日次HO / HO判定")).toBe(
    "卒業課題 / 今日の課題 / 課題判定",
  );
});

import { graduationProgress } from "../src/ui/graduationProgress";
it("graduation progress uses only own goal, records and public counts", () => {
  const s = createGame(setup);
  s.players[0].longGoal.id = 21;
  expect(graduationProgress(s)).toEqual(["休息成功 0 / 3夜"]);
  s.logs.push({
    seq: 999,
    day: 1,
    phase: "results",
    type: "rest",
    actor: 0,
    audience: "dev",
    text: "hidden",
  });
  expect(graduationProgress(s)).toEqual(["休息成功 0 / 3夜"]);
  const before = JSON.stringify(s);
  for (const id of [
    1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    25,
  ]) {
    s.players[0].longGoal.id = id;
    expect(graduationProgress(s).length).toBeGreaterThan(0);
  }
  s.players[0].longGoal.id = 21;
  expect(JSON.stringify(s)).toBe(before);
});
