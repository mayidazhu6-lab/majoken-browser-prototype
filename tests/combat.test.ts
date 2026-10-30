import { describe, it, expect } from "vitest";
import {
  calculateRound,
  damage,
  loadout,
  resolveRound,
  startCombat,
} from "../src/domain/combat";
import { createGame, dispatch } from "../src/domain/reducer";
import { addItem } from "../src/domain/items";
const game = () =>
  createGame({
    name: "戦闘魔女",
    seed: "combat",
    magic: "illusion",
    stats: { attack: 4, defense: 3, insight: 3 },
  });
const stats = { attack: 4, defense: 4, insight: 4 };
const zero = { attack: 0, defense: 0, charge: 0 };
describe("Phase 3 新戦闘", () => {
  it("A07 差分ダメージ・防御カウンター", () => {
    expect([-2, 0, 1, 2, 3, 5].map(damage)).toEqual([0, 0, 1, 1, 3, 5]);
    const r = calculateRound(
      [stats, stats],
      ["attack", "defend"],
      [1, 6],
      [0, 0],
      [zero, zero],
    );
    expect(r.damage).toEqual([5, 0]);
  });
  it("ためるは洞察＋出目、次R消費、ため中カウンターなし", () => {
    const r = calculateRound(
      [stats, stats],
      ["charge", "attack"],
      [6, 1],
      [12, 0],
      [zero, zero],
    );
    expect(r.charge).toEqual([10, 0]);
    expect(r.damage).toEqual([1, 0]);
    const next = calculateRound(
      [stats, stats],
      ["attack", "defend"],
      [1, 1],
      r.charge,
      [zero, zero],
    );
    expect(next.values[0]).toBe(15);
    expect(next.charge[0]).toBe(0);
  });
  it("攻撃vs攻撃は独立ダメージ、同時KO引分", () => {
    const s = game();
    s.players[0].stats.attack = 100;
    s.players[1].stats.attack = 100;
    startCombat(s, 0, 1, "public");
    const c = resolveRound(s, ["attack", "attack"], [undefined, undefined]);
    expect(c.hp).toEqual([0, 0]);
    expect(c.winner).toBe(null);
  });
  it("HP20・1D6・最大5Rで終了、連続ためる拒否", () => {
    const s = game();
    const c = startCombat(s, 0, 1, "public");
    expect(c.hp).toEqual([20, 20]);
    resolveRound(s, ["charge", "defend"], [undefined, undefined]);
    expect(() =>
      resolveRound(s, ["charge", "defend"], [undefined, undefined]),
    ).toThrow();
    for (let i = 1; i < 5; i++)
      resolveRound(s, ["defend", "defend"], [undefined, undefined]);
    expect(c.done).toBe(true);
    expect(c.rounds).toHaveLength(5);
    expect(
      c.rounds.flatMap((r) => r.rolls).every((n) => n >= 1 && n <= 6),
    ).toBe(true);
  });
  it("A08 持込上限1/2/3・Lv3薬制限・未使用消滅", () => {
    for (const insight of [3, 6, 9]) {
      const s = game();
      s.players[0].stats.insight = insight;
      const ids = Array.from(
        { length: 4 },
        () => addItem(s, s.players[0], "strike").id,
      );
      startCombat(s, 0, 1, "public");
      expect(() => loadout(s, s.players[0], ids)).toThrow();
      if (insight < 9)
        expect(() => loadout(s, s.players[0], [ids[0]])).toThrow();
      else {
        loadout(s, s.players[0], ids.slice(0, 3));
        expect(s.combat?.brought[0]).toHaveLength(3);
        for (let i = 0; i < 5; i++)
          resolveRound(s, ["defend", "defend"], [undefined, undefined]);
        expect(s.combat?.brought[0]).toHaveLength(0);
        expect(
          s.players[0].inventory.some((i) => ids.slice(0, 3).includes(i.id)),
        ).toBe(false);
      }
    }
  });
  it("1R1薬、補正は当該Rのみ", () => {
    const s = game();
    s.players[0].stats.insight = 9;
    const item = addItem(s, s.players[0], "strike");
    startCombat(s, 0, 1, "public");
    loadout(s, s.players[0], [item.id]);
    resolveRound(s, ["attack", "defend"], [item.id, undefined]);
    expect(s.combat?.rounds[0].potions[0]).toBe("strike");
    expect(s.combat?.brought[0]).toHaveLength(0);
    expect(() =>
      resolveRound(s, ["attack", "defend"], [item.id, undefined]),
    ).toThrow();
  });
  it("A09 連夜襲撃禁止・警戒・呪詛Lv・偵察FP下限", () => {
    let s = game();
    s.phase = "night";
    s.players.forEach((p) => (p.night = { kind: "guard" }));
    s.players[0].night = undefined;
    s.players[0].lastRaid = 0;
    expect(() =>
      dispatch(s, {
        type: "night",
        player: 0,
        choice: { kind: "raid", target: 1 },
      }),
    ).toThrow("連夜");
    s = dispatch(s, {
      type: "night",
      player: 0,
      choice: { kind: "scout", target: 1 },
    });
    s = dispatch(s, { type: "advance" });
    s = dispatch(s, { type: "advance" });
    s = dispatch(s, { type: "advance" });
    expect(s.players[1].fp).toBe(0);
    expect(s.phase).toBe("ho");
  });
});
