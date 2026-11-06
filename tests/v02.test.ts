import { describe, expect, it } from "vitest";
import {
  calculateRound,
  loadout,
  resolveRound,
  startCombat,
} from "../src/domain/combat";
import { createGame, currentPlayer, dispatch } from "../src/domain/reducer";
import { addItem, available, canRecipe, recipe } from "../src/domain/items";
import { deserialize, replay, serialize } from "../src/domain/persistence";
import { simulationAction } from "../src/domain/simulation";
import { eventProgress } from "../src/domain/events";
import type { Action, GameState, Stance } from "../src/domain/types";

const setup = {
  name: "試験魔女",
  seed: "v02-turns",
  magic: "barrier" as const,
  stats: { attack: 4, defense: 3, insight: 3 },
};
function quietGame() {
  const s = createGame(setup);
  s.event = {
    id: 3,
    specified: "water",
    reservations: [],
    mock: [],
    resolved: false,
  };
  for (const p of s.players.slice(1)) {
    p.longGoal = { id: 21, targets: [], achieved: false };
    p.dailyGoal = { id: 6, targets: [], achieved: false };
  }
  return s;
}
function finishFight(s: GameState) {
  for (let n = 0; s.combat && n < 7; n++) {
    s = dispatch(
      s,
      s.combat.done
        ? { type: "combatAck", player: 0 }
        : { type: "round", player: 0, stance: "defend" },
    );
  }
  expect(s.combat).toBeUndefined();
  return s;
}
const zero = { attack: 0, defense: 0, charge: 0 };
const stats = { attack: 4, defense: 4, insight: 4 };
describe("v0.2 戦闘", () => {
  it.each([-5, -3, -2, -1, 0, 1, 2, 3, 5])(
    "攻撃－防御=%i：完全防御と正の防御超過だけカウンター（両席）",
    (diff) => {
      for (const attackSide of [0, 1]) {
        const choices: [Stance, Stance] =
          attackSide === 0 ? ["attack", "defend"] : ["defend", "attack"];
        const rolls: [number, number] =
          attackSide === 0
            ? [Math.max(1, 1 + diff), Math.max(1, 1 - diff)]
            : [Math.max(1, 1 - diff), Math.max(1, 1 + diff)];
        const r = calculateRound(
          [stats, stats],
          choices,
          rolls,
          [0, 0],
          [zero, zero],
        );
        expect(r.damage[1 - attackSide]).toBe(0);
        expect(r.damage[attackSide]).toBe(diff < -2 ? -diff : diff < 0 ? 1 : 0);
      }
    },
  );
  it("攻撃vsためるは無防備、ためる側カウンターなし。防御vsためるは双方0", () => {
    expect(
      calculateRound(
        [stats, stats],
        ["attack", "charge"],
        [6, 1],
        [0, 0],
        [zero, zero],
      ).damage,
    ).toEqual([0, 7]);
    const r = calculateRound(
      [stats, stats],
      ["charge", "attack"],
      [6, 1],
      [0, 0],
      [zero, zero],
    );
    expect(r.damage).toEqual([2, 0]);
    expect(r.charge).toEqual([10, 0]);
    expect(
      calculateRound(
        [stats, stats],
        ["defend", "charge"],
        [1, 6],
        [9, 0],
        [zero, zero],
      ).damage,
    ).toEqual([0, 0]);
  });
  it("各Rの計算材料を記録し、警戒は攻撃に加算せず、秘匿ログを当事者に限定", () => {
    const s = quietGame();
    s.phase = "duels";
    s.players[0].stats.insight = 9;
    s.players[0].night = { kind: "guard" };
    const potion = addItem(s, s.players[0], "focus");
    startCombat(s, 0, 1, "secret");
    loadout(s, s.players[0], [potion.id]);
    resolveRound(s, ["charge", "defend"], [potion.id, undefined]);
    const r = s.combat!.rounds[0];
    expect(r.base).toEqual([9, s.players[1].stats.defense]);
    expect(r.insight[0]).toBe(9);
    expect(r.nextCharge[0]).toBe(9 + r.rolls[0] + 4);
    expect(r.values[0]).toBe(9 + r.rolls[0] + 4);
    expect(r.counter).toEqual([false, false]);
    resolveRound(s, ["attack", "defend"], [undefined, undefined]);
    const next = s.combat!.rounds[1];
    expect(next.chargeBonus[0]).toBe(r.nextCharge[0]);
    expect(next.values[0]).toBe(4 + next.rolls[0] + r.nextCharge[0]);
    expect(next.guard[0]).toBe(0);
    expect(
      s.logs
        .filter((l) => l.type === "combatRound")
        .every((l) => JSON.stringify(l.audience) === "[0,1]"),
    ).toBe(true);
    expect(
      s.logs
        .filter((l) => l.audience === "public")
        .some((l) => l.type === "combatRound"),
    ).toBe(false);
  });
});

describe("v0.2 公開手番・割り込み", () => {
  it("開始時はAIが行動せず、人間の手番終了で1巡分だけ自動進行する", () => {
    let s = quietGame();
    expect(s.players.map((p) => p.ap)).toEqual([2, 2, 2, 2]);
    s = dispatch(s, { type: "gather", player: 0 });
    expect(s.players.map((p) => p.ap)).toEqual([1, 2, 2, 2]);
    expect(() => dispatch(s, { type: "gather", player: 0 })).toThrow(
      "通常行動",
    );
    expect(() => dispatch(s, { type: "gather", player: 1 })).toThrow("手番");
    s = dispatch(s, { type: "endTurn", player: 0 });
    expect(s.publicTurn.round).toBe(2);
    expect(currentPlayer(s)).toBe(0);
    expect(s.players.map((p) => p.ap)).toEqual([1, 1, 1, 1]);
    const ordered = s.logs
      .filter((l) => ["gather", "research"].includes(l.type))
      .map((l) => l.actor);
    expect(ordered).toEqual([0, 1, 2, 3]);
    expect(() => dispatch(s, { type: "advance" })).toThrow("公開2巡");
  });
  it("日替わりの順序を8日間維持し、各巡は各席1回、2巡後は自動判定", () => {
    let s = createGame({ ...setup, seed: "lab-77" });
    for (let n = 0; s.phase !== "ended" && n < 500; n++) {
      const expected = Array.from({ length: 4 }, (_, i) => (s.day - 1 + i) % 4);
      expect(s.publicTurn.order).toEqual(expected);
      s = dispatch(s, simulationAction(s));
    }
    expect(s.day).toBe(8);
    expect(s.result?.reason).toBe("completed");
    for (let day = 1; day <= 8; day++) {
      for (let round = 1; round <= 2; round++) {
        const turns = s.logs.filter(
          (l) =>
            l.day === day && l.type === "turnEnd" && l.data?.round === round,
        );
        expect(turns.map((l) => l.actor)).toEqual(
          Array.from({ length: 4 }, (_, i) => (day - 1 + i) % 4),
        );
      }
    }
  });
  it("パスはAPを消費せず、巡の枠を持ち越さない", () => {
    let s = quietGame();
    s = dispatch(s, { type: "endTurn", player: 0 });
    expect(s.players[0].ap).toBe(2);
    expect(s.publicTurn.round).toBe(2);
    s = dispatch(s, { type: "gather", player: 0 });
    s = dispatch(s, { type: "endTurn", player: 0 });
    expect(s.publicTurn.round).toBe(4);
    expect(s.players[0].ap).toBe(1);
    expect(s.event.resolved).toBe(true);
    expect(() => dispatch(s, { type: "gather", player: 0 })).toThrow(
      "結果を確認",
    );
    s = dispatch(s, { type: "eventAck", player: 0 });
    expect(s.phase).toBe("magic");
  });
  it("1AP公開決闘は1巡目の1行動。2巡目も通常行動可能", () => {
    let s = quietGame();
    s = dispatch(s, { type: "duel", player: 0, target: 1 });
    expect(s.players.map((p) => p.ap)).toEqual([1, 2, 2, 2]);
    expect(s.publicTurn.acted).toBe(true);
    expect(() => dispatch(s, { type: "endTurn", player: 0 })).toThrow("戦闘中");
    s = finishFight(s);
    expect(currentPlayer(s)).toBe(0);
    expect(s.publicTurn.round).toBe(1);
    s = dispatch(s, { type: "endTurn", player: 0 });
    expect(s.publicTurn.round).toBe(2);
    expect(currentPlayer(s)).toBe(0);
    expect(s.players[0].ap).toBe(1);
    expect(
      s.logs.filter((l) => l.actor === 0 && l.type === "combatStart"),
    ).toHaveLength(1);
  });
  it("被挑戦者は手番外で応答し、APを消費せず元の順番に復帰", () => {
    let s = quietGame();
    s.publicTurn.index = 1;
    s = dispatch(s, { type: "duel", player: 1, target: 0 });
    expect(s.challenge).toEqual({ from: 1, to: 0, mock: false });
    expect(currentPlayer(s)).toBe(1);
    expect(s.players[0].ap).toBe(2);
    s = dispatch(s, { type: "challengeReply", player: 0, fight: true });
    s = finishFight(s);
    expect(s.players[0].ap).toBe(2);
    expect(currentPlayer(s)).toBe(0);
    expect(s.publicTurn.round).toBe(2);
    expect(s.players[1].ap).toBe(1);
    expect(s.logs.filter((l) => l.type === "combatStart")).toHaveLength(1);
  });
  it("強制命令2件は2巡に分割し、採集／研究以外やパスでは回避できない", () => {
    let s = quietGame();
    s.players[0].commands = [{ from: 1 }, { from: 2 }];
    expect(() => dispatch(s, { type: "endTurn", player: 0 })).toThrow("命令");
    expect(() => dispatch(s, { type: "gather", player: 0 })).toThrow("命令");
    s = dispatch(s, { type: "forced", player: 0, kind: "gather" });
    expect(s.players[0].commands).toHaveLength(1);
    expect(() =>
      dispatch(s, { type: "forced", player: 0, kind: "gather" }),
    ).toThrow("通常行動");
    s = dispatch(s, { type: "endTurn", player: 0 });
    addItem(s, s.players[0], "obsidian");
    addItem(s, s.players[0], "crystal");
    s = dispatch(s, {
      type: "forced",
      player: 0,
      kind: "research",
      stat: "attack",
    });
    expect(s.players[0].commands).toHaveLength(0);
    expect(s.players[0].ap).toBe(0);
    expect(
      s.logs.filter((l) => l.type === "commandExecuted").map((l) => l.actor),
    ).toEqual([1, 2]);
  });
  it("0AP納品・撤回を連続しても手番・APが変わらず、2巡終了時に自動でイベント確定", () => {
    let s = quietGame();
    s.event.id = 1;
    const id = s.players[0].inventory[0].id;
    for (let n = 0; n < 20; n++) {
      s = dispatch(s, { type: "reserve", player: 0, items: [id], stats: {} });
      s = dispatch(s, { type: "withdraw", player: 0 });
    }
    expect(s.publicTurn.round).toBe(1);
    expect(s.players.map((p) => p.ap)).toEqual([2, 2, 2, 2]);
    s = dispatch(s, { type: "endTurn", player: 0 });
    s = dispatch(s, { type: "endTurn", player: 0 });
    expect(s.publicTurn.round).toBe(4);
    expect(s.event.resolved).toBe(true);
    expect(() => dispatch(s, { type: "withdraw", player: 0 })).toThrow(
      "結果を確認",
    );
    expect(eventProgress(s)).toEqual(s.event.finalProgress);
  });
});

describe("v0.2 取引", () => {
  it("AP0でも成立、拒否を含め同じ相手へ1巡2回まで。翌巡は再申請可", () => {
    let s = quietGame();
    s.players[0].ap = 0;
    s.publicTurn.acted = true;
    const id = s.players[0].inventory[0].id;
    s = dispatch(s, {
      type: "trade",
      player: 0,
      target: 1,
      offer: [id],
      request: {},
    });
    expect(s.players[0].ap).toBe(0);
    expect(s.players[1].ap).toBe(2);
    expect(s.players[1].inventory.some((i) => i.id === id)).toBe(true);
    expect(
      s.logs
        .filter((l) => l.type === "trade")
        .every((l) => JSON.stringify(l.audience) === "[0,1]"),
    ).toBe(true);
    expect(s.logs.find((l) => l.type === "trade")?.text).toContain("から");
    s = dispatch(s, {
      type: "trade",
      player: 0,
      target: 1,
      offer: [],
      request: { dew: 999 },
    });
    expect(s.logs.filter((l) => l.type === "tradeRejected")).toHaveLength(1);
    expect(() =>
      dispatch(s, {
        type: "trade",
        player: 0,
        target: 1,
        offer: [],
        request: { dew: 999 },
      }),
    ).toThrow("1巡2回");
    expect(s.publicTurn.tradeAttempts["1:0:1"]).toBe(2);
    // A second-round human turn with AP after a first-round pass.
    let next = quietGame();
    const request: Action = {
      type: "trade",
      player: 0,
      target: 1,
      offer: [],
      request: { dew: 999 },
    };
    next = dispatch(dispatch(next, request), request);
    next = dispatch(next, { type: "endTurn", player: 0 });
    next = dispatch(next, request);
    expect(next.publicTurn.tradeAttempts["2:0:1"]).toBe(1);
  });
  it.each(["reject", "accept", "cancel"])(
    "AI取引の%s後は再申請ループせず、1手番1件で通常行動へ復帰",
    (reply) => {
      let s = quietGame();
      s.players[1].dailyGoal.id = 8;
      s = dispatch(s, { type: "endTurn", player: 0 });
      expect(s.trades).toHaveLength(1);
      expect(currentPlayer(s)).toBe(1);
      const t = s.trades[0];
      expect(t.to).toBe(0);
      expect(s.players[1].ap).toBe(2);
      expect(
        s.players[1].inventory.find((i) => i.id === t.offer[0])?.lock,
      ).toBe(`trade:${t.id}`);
      expect(() => dispatch(s, { type: "endTurn", player: 1 })).toThrow("返答");
      expect(() => dispatch(s, { type: "advance" })).toThrow("公開2巡");
      expect(() =>
        dispatch(s, { type: "tradeReply", player: 2, id: t.id, accept: true }),
      ).toThrow("取引がありません");
      s = dispatch(
        s,
        reply === "cancel"
          ? { type: "tradeCancel", player: 1, id: t.id }
          : {
              type: "tradeReply",
              player: 0,
              id: t.id,
              accept: reply === "accept",
            },
      );
      expect(s.trades).toHaveLength(0);
      expect(s.publicTurn.tradeAttempts["1:1:0"]).toBe(1);
      expect(s.players[1].ap).toBe(1);
      expect(currentPlayer(s)).toBe(0);
      expect(s.publicTurn.round).toBe(2);
      expect(
        s.players
          .flatMap((p) => p.inventory)
          .every((i) => !i.lock?.startsWith("trade:")),
      ).toBe(true);
    },
  );
  it("撤回も申請回数に含む。取引は当事者だけ、所有権とロックを維持", () => {
    let s = quietGame();
    // Human recipient enables an explicit pending response without automatic AI acceptance.
    s.players[1].ai = false;
    const id = s.players[0].inventory[0].id;
    for (let n = 0; n < 2; n++) {
      s = dispatch(s, {
        type: "trade",
        player: 0,
        target: 1,
        offer: [id],
        request: {},
      });
      expect(available(s.players[0]).some((i) => i.id === id)).toBe(false);
      s = dispatch(s, { type: "tradeCancel", player: 0, id: s.trades[0].id });
      expect(available(s.players[0]).some((i) => i.id === id)).toBe(true);
    }
    expect(() =>
      dispatch(s, {
        type: "trade",
        player: 0,
        target: 1,
        offer: [id],
        request: {},
      }),
    ).toThrow("1巡2回");
    expect(s.players[0].ap).toBe(2);
  });
});

describe("v0.2 夜錬金・秘伝レシピ", () => {
  it("複数レシピ・同種複数を上限なく作成、全件私有ログで他の夜行動は排他", () => {
    let s = quietGame();
    s.phase = "night";
    const plan = [...Array<string>(12).fill("vigor"), "study", "watch"];
    for (const id of plan)
      for (const material of recipe(id)!.materials)
        addItem(s, s.players[0], material);
    s = dispatch(s, {
      type: "night",
      player: 0,
      choice: { kind: "brew", recipes: plan },
    });
    expect(() =>
      dispatch(s, { type: "night", player: 0, choice: { kind: "rest" } }),
    ).toThrow("確定済み");
    const ap = s.players[0].ap;
    s = dispatch(s, { type: "advance" });
    expect(s.players[0].ap).toBe(ap);
    expect(
      s.logs.filter((l) => l.actor === 0 && l.type === "brew"),
    ).toHaveLength(plan.length);
    expect(
      s.logs
        .filter(
          (l) =>
            l.actor === 0 &&
            ["brew", "acquirePotion", "nightChoice"].includes(l.type),
        )
        .every((l) => JSON.stringify(l.audience) === "[0]"),
    ).toBe(true);
  });
  it.each([{ plan: ["vigor", "vigor"] }, { plan: ["harvest"] }, { plan: [] }])(
    "材料不足・未解放・空計画は原子的に拒否：$plan",
    ({ plan }) => {
      const s = quietGame();
      s.phase = "night";
      s.players[0].inventory = [];
      addItem(s, s.players[0], "crystal");
      addItem(s, s.players[0], "sand");
      const before = structuredClone(s);
      expect(() =>
        dispatch(s, {
          type: "night",
          player: 0,
          choice: { kind: "brew", recipes: plan },
        }),
      ).toThrow();
      expect(s).toEqual(before);
    },
  );
  it("公開錬金は拒否、秘伝は翌公開終了で失効せず翌夜の錬金に使用できる", () => {
    let s = quietGame();
    expect(() =>
      dispatch(s, { type: "brew", player: 0, recipe: "vigor" }),
    ).toThrow("公開錬金は廃止");
    s.players[0].temporaryRecipe = { kind: "harvest", day: 2 };
    s.day = 2;
    s.publicTurn.round = 4;
    s = dispatch(s, { type: "advance" });
    expect(canRecipe(s.players[0], "harvest", 2)).toBe(true);
    s = dispatch(s, { type: "eventAck", player: 0 });
    s.phase = "night";
    addItem(s, s.players[0], "crystal");
    addItem(s, s.players[0], "sand");
    s = dispatch(s, {
      type: "night",
      player: 0,
      choice: { kind: "brew", recipes: ["harvest"] },
    });
    s = dispatch(s, { type: "advance" });
    expect(s.players[0].inventory.some((i) => i.kind === "harvest")).toBe(true);
    s.phase = "dawn";
    s = dispatch(s, { type: "advance" });
    expect(s.day).toBe(3);
    expect(s.players[0].temporaryRecipe).toBeUndefined();
    expect(canRecipe(s.players[0], "harvest", 3)).toBe(false);
  });
});

describe("v0.2 保存・再生", () => {
  it("v0.1は明示的な版不一致。新版操作ログの偽装・手番改変も拒否", () => {
    const s = createGame(setup);
    const old = JSON.parse(serialize(s));
    old.version = 1;
    old.state.rulesVersion = "browser-0.1+decisions-1";
    expect(() => deserialize(JSON.stringify(old))).toThrow(
      "バージョンが一致しません",
    );
    const changed = JSON.parse(serialize(s));
    changed.state.publicTurn.index = 1;
    expect(() => deserialize(JSON.stringify(changed))).toThrow("一致しません");
  });
  it("公開決闘の途中・結果確認待ちから再開しても手番とAPが重複しない", () => {
    let s = createGame({
      ...setup,
      seed: "reward-5",
      stats: { attack: 2, defense: 2, insight: 6 },
    });
    s = dispatch(s, { type: "duel", player: 0, target: 1 });
    for (let round = 0; round < 5; round++) {
      s = deserialize(serialize(s));
      expect(s.players[0].ap).toBe(1);
      expect(s.publicTurn.acted).toBe(true);
      s = dispatch(s, {
        type: "round",
        player: 0,
        stance: round < 4 && round % 2 === 0 ? "charge" : "defend",
      });
    }
    expect(s.combat?.done).toBe(true);
    const saved = deserialize(serialize(s));
    const a: Action = { type: "combatAck", player: 0 };
    expect(dispatch(saved, a)).toEqual(dispatch(s, a));
    s = dispatch(saved, a);
    expect(s.phase).toBe("public");
    expect(s.publicTurn.round).toBe(1);
    expect(currentPlayer(s)).toBe(0);
    expect(s.players[0].ap).toBe(1);
    expect(s.combatHistory).toHaveLength(1);
  });
  it("通常手番・取引返答待ち・戦闘・夜錬金・日替わりの各地点で保存と再生が一致", () => {
    // Real action histories, never patched fixtures, cover checkpoints over eight days.
    let s = createGame({
      ...setup,
      seed: "moon-42",
      stats: { attack: 3, defense: 4, insight: 3 },
    });
    const seen = new Set<string>();
    for (let n = 0; s.phase !== "ended" && n < 500; n++) {
      const key = s.trades.length
        ? "trade"
        : s.combat
          ? s.combat.done
            ? "reward"
            : "combat"
          : s.phase === "public"
            ? `turn:${s.publicTurn.round}`
            : s.phase === "night" && s.players[0].night?.kind === "brew"
              ? "brew"
              : s.phase;
      if (!seen.has(key)) {
        seen.add(key);
        const saved = deserialize(serialize(s));
        expect(saved).toEqual(s);
        expect(replay(s.setup, s.actions)).toEqual(s);
        const a = simulationAction(s);
        expect(dispatch(saved, a)).toEqual(dispatch(s, a));
      }
      s = dispatch(s, simulationAction(s));
    }
    expect(s.day).toBe(8);
    expect(s.result?.reason).toBe("completed");
    for (const key of [
      "turn:1",
      "turn:2",
      "magic",
      "trade",
      "combat",
      "brew",
      "dawn",
    ])
      expect(seen.has(key), key).toBe(true);
  });
});
