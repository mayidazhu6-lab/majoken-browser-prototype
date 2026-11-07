import { describe, expect, it } from "vitest";
import { uiText } from "../src/ui/text";
import { elementDamage } from "../src/domain/elementCombat";
import { calculateRound } from "../src/domain/combat";

describe("public information presentation", () => {
  it("translates display text without changing stored logs", () => {
    const log = {
      text: "アリア：1巡目・手番終了 / 第2巡 / 同じ相手への申請は1巡2回までです",
    };
    expect(uiText(log.text)).toBe(
      "アリア：午前・手番終了 / 午後 / 同じ相手への申請は各時間帯2回までです",
    );
    expect(log.text).toContain("1巡目");
  });
  it.each([
    ["attack", "insight"],
    ["insight", "defense"],
    ["defense", "attack"],
  ] as const)("diagram %s → %s agrees with combat", (a, b) => {
    expect(elementDamage(3, a, b, false).affinity).toBe(1);
    expect(elementDamage(3, b, a, false).affinity).toBe(-1);
    expect(elementDamage(3, a, a, false).affinity).toBe(0);
  });
  it("legacy defense can counter and charge does not act as a fixed winning hand", () => {
    const stats = [
      { attack: 3, defense: 3, insight: 3 },
      { attack: 3, defense: 9, insight: 3 },
    ] as [
      { attack: number; defense: number; insight: number },
      { attack: number; defense: number; insight: number },
    ];
    const buffs = [
      { attack: 0, defense: 0, charge: 0 },
      { attack: 0, defense: 0, charge: 0 },
    ] as [
      { attack: number; defense: number; charge: number },
      { attack: number; defense: number; charge: number },
    ];
    expect(
      calculateRound(stats, ["attack", "defend"], [1, 1], [0, 0], buffs).damage,
    ).toEqual([6, 0]);
    expect(
      calculateRound(stats, ["attack", "charge"], [1, 1], [0, 0], buffs).damage,
    ).toEqual([0, 1]);
  });
});
