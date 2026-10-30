import { describe, it, expect } from "vitest";
import { createGame, dispatch } from "../src/domain/reducer";
import {
  dailyAchieved,
  longAchieved,
  DAILY_GOALS,
  LONG_GOALS,
  goalDescription,
} from "../src/domain/ho";
import { log } from "../src/domain/core";
import { startCombat, resolveRound } from "../src/domain/combat";
import { addItem } from "../src/domain/items";
function fixture() {
  const s = createGame({
    name: "HO試験",
    seed: "goals",
    magic: "barrier",
    stats: { attack: 4, defense: 3, insight: 3 },
  });
  s.day = 8;
  s.logs = [];
  s.players[0].fp = 10;
  for (const p of s.players.slice(1)) p.fp = 1;
  for (const p of s.players) p.stats = { attack: 3, defense: 3, insight: 3 };
  s.players[0].stats = { attack: 6, defense: 6, insight: 6 };
  s.players[0].inventory = [];
  for (const p of s.players.slice(1)) p.inventory = [];
  addItem(s, s.players[0], "water");
  const fact = (
    type: string,
    target = 1,
    amount = 1,
    data?: Record<string, unknown>,
    kind?: string,
  ) =>
    log(s, type, "fixture", {
      actor: 0,
      target,
      amount,
      data,
      kind,
      audience: [0],
    });
  for (const target of [1, 1, 2, 3]) fact("trade", target, 1, { received: 0 });
  for (const target of [1, 2, 3]) {
    fact("receive", target, 2);
    fact("give", target, 3);
  }
  fact("givePotion", 1, 3);
  fact("gather", 1, 2);
  fact("research", 1, 2);
  fact("brew");
  fact("acquirePotion");
  fact("contribution");
  fact("contribution");
  fact("contribution");
  fact("fp", 1, 1, undefined, "event");
  fact("curseHit");
  fact("guard");
  fact("loot");
  fact("command");
  fact("commandExecuted", 1);
  fact("commandExecuted", 2);
  fact("defensiveWin");
  fact("defensiveWin");
  for (const kind of ["vigor", "study", "cleanse"])
    fact("usePotion", 1, 1, undefined, kind);
  for (const [a, b, winner, kind] of [
    [0, 1, 0, "public"],
    [0, 1, 0, "public"],
    [0, 2, 0, "public"],
    [0, 3, 0, "public"],
    [0, 1, 1, "public"],
    [0, 2, 2, "public"],
    [1, 2, 2, "public"],
    [0, 1, 0, "secret"],
  ] as const) {
    s.phase = kind === "secret" ? "duels" : "public";
    const c = startCombat(s, a, b, kind);
    for (let i = 0; i < 3; i++)
      resolveRound(s, ["defend", "defend"], [undefined, undefined]);
    c.done = true;
    c.winner = winner;
    c.rounds[0].damage = [1, 0];
    c.rounds.forEach((r) => (r.original = ["attack", "attack"]));
    s.combatHistory.push(c);
    for (const id of c.participants)
      log(s, "combat", "fixture", {
        actor: id,
        data: { id: c.id },
        audience: [id],
      });
    log(s, "win", "fixture", {
      actor: winner,
      target: winner === a ? b : a,
      data: { initiator: a },
      audience: [winner],
    });
  }
  s.combat = undefined;
  s.phase = "results";
  for (const target of [1, 1, 2, 3]) fact("scout", target, 1);
  for (const day of [1, 3, 8]) {
    s.day = day;
    fact("rest");
  }
  s.day = 8;
  return s;
}
describe("A03 全46種HOの成立例と不成立境界", () => {
  for (const g of DAILY_GOALS)
    it(`日次${g.id} ${g.name} 成立例`, () => {
      const s = fixture();
      expect(
        dailyAchieved(s, s.players[0], {
          id: g.id,
          targets: [],
          achieved: false,
        }),
      ).toBe(true);
    });
  for (const g of LONG_GOALS)
    it(`長期${g.id} ${g.name} 成立例`, () => {
      const s = fixture();
      if (g.id === 25) {
        s.players[0].inventory = [];
        for (const p of s.players.slice(1)) addItem(s, p, "dew");
      }
      expect(
        longAchieved(s, s.players[0], {
          id: g.id,
          targets: [1, 2],
          achieved: false,
        }),
      ).toBe(true);
    });
  it("成長0では勤勉／研究熱心は達成しない", () => {
    const s = fixture();
    s.logs = s.logs.filter((l) => l.type !== "research");
    log(s, "research", "呪詛で成長0", { actor: 0, amount: 0 });
    for (const id of [1, 4])
      expect(
        dailyAchieved(s, s.players[0], { id, targets: [], achieved: false }),
      ).toBe(false);
  });
  it("偵察FP減点・アイテム確認0は成功偵察HOを満たさない", () => {
    const s = fixture();
    s.logs = s.logs.filter((l) => l.type !== "scout");
    log(s, "scout", "所持なし", {
      actor: 0,
      target: 1,
      amount: 0,
      audience: [0],
    });
    expect(
      dailyAchieved(s, s.players[0], { id: 13, targets: [], achieved: false }),
    ).toBe(false);
    expect(
      longAchieved(s, s.players[0], { id: 7, targets: [1], achieved: false }),
    ).toBe(false);
  });
  it("取引→偵察の順序と異なる2人を要求", () => {
    const s = fixture();
    s.logs = s.logs.filter((l) => l.type !== "trade");
    log(s, "trade", "後から取引", {
      actor: 0,
      target: 1,
      amount: 1,
      audience: [0],
    });
    expect(
      longAchieved(s, s.players[0], { id: 12, targets: [], achieved: false }),
    ).toBe(false);
  });
  it("戦術HOは別戦闘の3手合算不可・模擬戦除外", () => {
    const s = fixture();
    s.combatHistory.forEach((c) => {
      c.rounds = c.rounds.slice(0, 1);
    });
    expect(
      dailyAchieved(s, s.players[0], { id: 24, targets: [], achieved: false }),
    ).toBe(false);
    s.combatHistory.forEach((c) => {
      c.kind = "mock";
    });
    expect(
      dailyAchieved(s, s.players[0], { id: 19, targets: [], achieved: false }),
    ).toBe(false);
  });
  it("最終FP単独最多・能力単独最多は同率を含まない", () => {
    const s = fixture();
    s.players[1].fp = 10;
    s.players[1].stats = { ...s.players[0].stats };
    expect(
      longAchieved(s, s.players[0], { id: 22, targets: [], achieved: false }),
    ).toBe(false);
  });
  it("第8日長期比較はHO報酬前・首席は報酬後FP", () => {
    let s = fixture();
    s.phase = "ho";
    s.players[0].longGoal = { id: 1, targets: [1], achieved: false };
    s.players[0].fp = 2;
    s.players[1].fp = 1;
    s.players[0].dailyGoal = { id: 18, targets: [], achieved: false };
    s = dispatch(s, { type: "advance" });
    expect(s.players[0].fp).toBe(3);
    expect(s.players[0].longGoal.achieved).toBe(false);
  });
  it("変換済み条件を表示（窃盗獲得は強奪、ラウンド得点は被ダメージ）", () => {
    expect(
      goalDescription({ id: 14, targets: [], achieved: false }, false)
        .condition,
    ).toContain("秘匿決闘");
    expect(
      goalDescription({ id: 21, targets: [], achieved: false }, false)
        .condition,
    ).toContain("被ダメージ");
  });
});
