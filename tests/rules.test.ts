import { describe, it, expect } from "vitest";
import { createGame, dispatch, aiView } from "../src/domain/reducer";
import { MATERIALS, STATS } from "../src/domain/config";
import { addItem, RECIPES } from "../src/domain/items";
import { fp } from "../src/domain/core";
import {
  DAILY_GOALS,
  LONG_GOALS,
  dailyAchieved,
  longAchieved,
} from "../src/domain/ho";
import {
  EVENTS,
  eventProgress,
  reserve,
  resolveEvent,
  withdraw,
} from "../src/domain/events";
const setup = {
  name: "魔女",
  seed: "rules",
  magic: "barrier" as const,
  stats: { attack: 4, defense: 3, insight: 3 },
};
const game = () => createGame(setup);
describe("Phase 2 主要行動", () => {
  it("A05 6素材を採集し、購買部3→1", () => {
    let s = game();
    s.players[0].inventory = [];
    for (const m of MATERIALS) addItem(s, s.players[0], m);
    s = dispatch(s, {
      type: "shop",
      player: 0,
      items: s.players[0].inventory.slice(0, 3).map((i) => i.id),
      receive: "dew",
    });
    expect(s.players[0].inventory).toHaveLength(4);
    expect(s.players[0].ap).toBe(1);
  });
  it("研究・休息全回・呪詛初回のみ", () => {
    let s = game();
    const p = s.players[0];
    p.inventory = [];
    p.rest = 2;
    p.curse = 2;
    for (let i = 0; i < 2; i++) {
      addItem(s, p, "obsidian");
      addItem(s, p, "crystal");
    }
    s = dispatch(s, { type: "research", player: 0, stat: "attack" });
    expect(s.players[0].stats.attack).toBe(5);
    expect(s.players[0].curse).toBe(0);
    s = dispatch(s, { type: "endTurn", player: 0 });
    for (const t of [...s.trades])
      s = dispatch(s, {
        type: "tradeReply",
        player: 0,
        id: t.id,
        accept: false,
      });
    s = dispatch(s, { type: "research", player: 0, stat: "attack" });
    expect(s.players[0].stats.attack).toBe(8);
    expect(() => dispatch(s, { type: "gather", player: 0 })).toThrow();
  });
  it("A04 納品予約ロック・過剰納品拒否・失敗返却", () => {
    const s = game();
    s.event = {
      id: 1,
      specified: "water",
      reservations: [],
      mock: [],
      resolved: false,
    };
    const ids = s.players[0].inventory.map((i) => i.id);
    reserve(s, s.players[0], ids, {});
    expect(() =>
      dispatch(s, { type: "shop", player: 0, items: ids, receive: "dew" }),
    ).toThrow();
    resolveEvent(s);
    expect(s.players[0].inventory).toHaveLength(3);
    expect(s.players[0].inventory.every((i) => !i.lock)).toBe(true);
  });
  it("成功納品のみ消費、能力下限と予約撤回", () => {
    const s = game();
    s.event = {
      id: 6,
      specified: "water",
      reservations: [],
      mock: [],
      resolved: false,
    };
    reserve(s, s.players[0], [], { attack: 2 });
    expect(() => reserve(s, s.players[0], [], { attack: 2 })).toThrow();
    reserve(s, s.players[1], [], {
      attack: Math.min(1, s.players[1].stats.attack - 1),
    });
    withdraw(s, s.players[1]);
    reserve(s, s.players[0], [], { defense: 2 });
    expect(eventProgress(s).success).toBe(true);
    resolveEvent(s);
    expect(s.players[0].stats.attack).toBe(2);
    expect(s.players[0].stats.defense).toBe(1);
    expect(s.players[0].fp).toBe(2);
  });
  it("取引成立・拒否ともAP消費なし", () => {
    let s = game();
    const id = s.players[0].inventory[0].id;
    s = dispatch(s, {
      type: "trade",
      player: 0,
      target: 1,
      offer: [id],
      request: {},
    });
    expect(s.players[0].ap).toBe(2);
    expect(s.players[1].ap).toBe(2);
    expect(s.players[1].inventory.some((i) => i.id === id)).toBe(true);
    const before = s.players[0].ap;
    s = dispatch(s, {
      type: "trade",
      player: 0,
      target: 1,
      offer: [],
      request: { dew: 999 },
    });
    expect(s.players[0].ap).toBe(before);
  });
  it("A06 FP5/10で一度だけ解放、減点しても再ロックなし", () => {
    const s = game(),
      p = s.players[0];
    fp(s, p, 5, "test");
    expect(p.recipes).toHaveLength(1);
    fp(s, p, -4, "scout");
    expect(p.recipes).toHaveLength(1);
    fp(s, p, 9, "test");
    expect(p.pendingRecipe).toBe(true);
    const r = RECIPES.find(
      (r) => r.tier === "special" && !p.recipes.includes(r.id),
    )!;
    const next = dispatch(s, { type: "unlock", player: 0, recipe: r.id });
    fp(next, next.players[0], -50, "scout");
    fp(next, next.players[0], 10, "test");
    expect(next.players[0].fp).toBe(10);
    expect(next.players[0].recipes).toHaveLength(2);
    expect(next.players[0].unlocks).toEqual([5, 10]);
  });
  it("全通常薬・特殊薬・才能変化薬レシピは既存5素材", () =>
    expect(
      RECIPES.every((r) =>
        r.materials.every((m) => MATERIALS.slice(0, 5).includes(m)),
      ),
    ).toBe(true));
});
describe("Phase 4 イベント・HO・AI・勝敗", () => {
  it("A02 イベント3失敗直後に終了し、当夜の処理なし", () => {
    let s = game();
    s.failed = 2;
    s.event = {
      id: 1,
      specified: "water",
      reservations: [],
      mock: [],
      resolved: false,
    };
    s.publicTurn.round = 4;
    s = dispatch(s, { type: "advance" });
    expect(s.phase).toBe("ended");
    expect(s.result?.reason).toBe("collapse");
    expect(s.players.every((p) => p.dailyHistory.length === 0)).toBe(true);
    expect(s.logs.some((l) => l.type === "nightResult")).toBe(false);
  });
  it("A03 全46HOは評価可能、ID維持", () => {
    const s = game();
    expect(LONG_GOALS).toHaveLength(22);
    expect(DAILY_GOALS).toHaveLength(24);
    for (const g of LONG_GOALS)
      expect(
        typeof longAchieved(s, s.players[0], {
          id: g.id,
          targets: [1, 2],
          achieved: false,
        }),
      ).toBe("boolean");
    for (const g of DAILY_GOALS)
      expect(
        typeof dailyAchieved(s, s.players[0], {
          id: g.id,
          targets: [],
          achieved: false,
        }),
      ).toBe("boolean");
  });
  it("HO配布は同日・長期とも重複なし", () => {
    const s = game();
    expect(new Set(s.players.map((p) => p.longGoal.id)).size).toBe(4);
    expect(new Set(s.players.map((p) => p.dailyGoal.id)).size).toBe(4);
  });
  it("全12イベントに成功条件と報酬", () => {
    expect(EVENTS).toHaveLength(12);
    for (const e of EVENTS) {
      const s = game();
      s.event = {
        id: e.id,
        specified: "water",
        reservations: [],
        mock: e.mock ? [0, 1] : [],
        resolved: false,
      };
      if (e.actions)
        for (let i = 0; i < 4; i++)
          s.logs.push({
            seq: s.logs.length + 1,
            day: 1,
            phase: "public",
            type: e.actions[0],
            actor: 0,
            audience: "public",
            text: "試験",
          });
      if (e.materials) {
        const kinds = Array(e.materials).fill(
          e.id === 11 ? "water" : (e.allowed?.[0] ?? "obsidian"),
        );
        let at = 0;
        for (const [k, n] of Object.entries(e.required ?? {}))
          for (let j = 0; j < n; j++) kinds[at++] = k;
        const ids = kinds.map((k) => addItem(s, s.players[0], k).id);
        reserve(s, s.players[0], ids, {});
      }
      if (e.stats && !e.either) {
        s.players[0].stats.attack = 10;
        reserve(s, s.players[0], [], { attack: e.stats });
      }
      if (e.potions)
        reserve(
          s,
          s.players[0],
          Array.from(
            { length: e.potions },
            () => addItem(s, s.players[0], "vigor").id,
          ),
          {},
        );
      expect(eventProgress(s).success, e.name).toBe(true);
      resolveEvent(s);
      expect(s.event.success).toBe(true);
    }
  });
  it("A10 AI入力から相手の秘密を除外", () => {
    const s = game();
    const before = aiView(s, 1);
    s.players[0].inventory = [];
    s.players[0].longGoal.id = 25;
    s.players[0].magic = "shadow";
    expect(aiView(s, 1)).toEqual(before);
    expect(
      before.others.every(
        (p) => !("inventory" in p) && !("longGoal" in p) && !("magic" in p),
      ),
    ).toBe(true);
  });
  it("FPだけでは卒業なし、同率首席とFP順位は別", () => {
    let s = game();
    s.day = 8;
    s.phase = "ho";
    for (const p of s.players) {
      p.longGoal = { id: 21, targets: [1], achieved: false };
      p.dailyGoal = { id: 18, targets: [], achieved: false };
    }
    s.players[0].fp = 99;
    s = dispatch(s, { type: "advance" });
    expect(s.result?.graduates).toEqual([]);
    expect(s.result?.chiefs).toEqual([]);
    expect(s.result?.ranking[0].rank).toBe(1);
  });
});

describe("最終レビューの回帰検証", () => {
  it("確定したイベント進捗を納品消費後も表示できる", () => {
    const s = game();
    s.event = {
      id: 1,
      specified: "water",
      reservations: [],
      mock: [],
      resolved: false,
    };
    const ids = Array.from(
      { length: 4 },
      () => addItem(s, s.players[0], "dew").id,
    );
    reserve(s, s.players[0], ids, {});
    resolveEvent(s);
    expect(eventProgress(s).materials).toBe(4);
    expect(eventProgress(s).success).toBe(true);
    expect(s.players[0].inventory.some((i) => ids.includes(i.id))).toBe(false);
  });
  it("数量上限を作らず、巨大な取引要求も在庫照合で拒否する", () => {
    const s = game();
    const next = dispatch(s, {
      type: "trade",
      player: 0,
      target: 1,
      offer: [],
      request: { dew: Number.MAX_SAFE_INTEGER },
    });
    expect(next.players[0].ap).toBe(2);
    expect(next.trades).toHaveLength(0);
  });
  it("AI同士の秘匿戦闘はまとめて解決し、件数・内容を公開通知しない", () => {
    let s = game();
    s.phase = "duels";
    s.duelQueue = [
      [1, 2],
      [2, 3],
    ];
    const from = s.logs.length;
    s = dispatch(s, { type: "advance" });
    expect(s.phase).toBe("results");
    expect(s.combatHistory).toHaveLength(2);
    expect(
      s.logs.slice(from).filter((l) => l.audience === "public"),
    ).toHaveLength(0);
  });
});
