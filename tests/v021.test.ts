import { describe, expect, it } from "vitest";
import {
  calculateRound,
  startCombat,
  resolveRound,
} from "../src/domain/combat";
import { createGame, dispatch } from "../src/domain/reducer";
import { addItem } from "../src/domain/items";
import {
  donationItems,
  reserve,
  reservationRoom,
  reservationUnits,
  withdraw,
  eventProgress,
  resolveEvent,
} from "../src/domain/events";
import { dailyProgress, dailyAchieved, DAILY_GOALS } from "../src/domain/ho";
import { level, nextLevel, levelEffect } from "../src/domain/config";
import { log } from "../src/domain/core";
import { serialize, deserialize } from "../src/domain/persistence";
import { simulationAction } from "../src/domain/simulation";
import type { GameState, Stance } from "../src/domain/types";
const setup = {
  name: "試験魔女",
  seed: "witches-2026",
  magic: "barrier" as const,
  stats: { attack: 3, defense: 4, insight: 3 },
};
const zero = { attack: 0, defense: 0, charge: 0 };
const stats = { attack: 4, defense: 4, insight: 4 };
function game(event = 1) {
  const s = createGame(setup);
  s.event = {
    id: event,
    specified: "water",
    reservations: [],
    mock: [],
    resolved: false,
  };
  return s;
}
describe("v0.2.1 無防備・強化・最終ラウンド", () => {
  it.each([2, 3, 5, 6, 9])(
    "攻撃判定%iはためるに必ず命中し、防御・同値・高い強化値では回避できない",
    (value) => {
      for (const side of [0, 1]) {
        const attacker = { attack: value - 1, defense: 99, insight: 99 };
        const charger = { attack: 1, defense: 999, insight: value - 1 };
        const ps: [typeof stats, typeof stats] =
          side === 0 ? [attacker, charger] : [charger, attacker];
        const choices: [Stance, Stance] =
          side === 0 ? ["attack", "charge"] : ["charge", "attack"];
        const r = calculateRound(
          ps,
          choices,
          [1, 1],
          [0, 0],
          [zero, zero],
          [999, 999],
        );
        expect(r.values).toEqual([value, value]);
        expect(r.damage[1 - side]).toBe(Math.max(1, Math.floor(value / 3)));
        expect(r.damage[side]).toBe(0);
      }
    },
  );
  it("ためる強化は攻撃・防御・カウンターに適用し、翌Rで消費する", () => {
    const charged = calculateRound(
      [stats, stats],
      ["charge", "defend"],
      [6, 1],
      [0, 0],
      [{ ...zero, charge: 4 }, zero],
    );
    expect(charged.charge).toEqual([14, 0]);
    const attack = calculateRound(
      [stats, stats],
      ["attack", "charge"],
      [1, 1],
      charged.charge,
      [zero, zero],
    );
    expect(attack.values[0]).toBe(19);
    expect(attack.damage).toEqual([0, 6]);
    expect(attack.charge[0]).toBe(0);
    const defense = calculateRound(
      [stats, stats],
      ["defend", "attack"],
      [1, 1],
      charged.charge,
      [zero, zero],
    );
    expect(defense.damage).toEqual([0, 14]);
    expect(defense.charge).toEqual([0, 0]);
    const next = calculateRound(
      [stats, stats],
      ["defend", "attack"],
      [1, 1],
      defense.charge,
      [zero, zero],
    );
    expect(next.damage).toEqual([0, 0]);
  });
  it("5R目のためるは持越し0で終了、連続ためる不可・最大5Rを維持", () => {
    const s = game();
    startCombat(s, 0, 1, "public");
    for (let n = 0; n < 4; n++)
      resolveRound(s, ["defend", "defend"], [undefined, undefined]);
    resolveRound(s, ["charge", "defend"], [undefined, undefined]);
    expect(s.combat!.done).toBe(true);
    expect(s.combat!.rounds).toHaveLength(5);
    expect(s.combat!.charge).toEqual([0, 0]);
    expect(s.combat!.rounds[4].nextCharge).toEqual([0, 0]);
    expect(() =>
      resolveRound(s, ["attack", "attack"], [undefined, undefined]),
    ).toThrow();
  });
});

describe("v0.2.1 第1巡の納品配分", () => {
  it("複数操作を合算して1人1個、取消で回復、第2巡は残枠に先着順", () => {
    const s = game();
    const p = s.players[0];
    const ids = Array.from({ length: 4 }, () => addItem(s, p, "water").id);
    reserve(s, p, [ids[0]], {});
    expect(reservationUnits(s, p)).toBe(1);
    expect(reservationRoom(s, p)).toBe(0);
    expect(donationItems(s, p)).toEqual([]);
    expect(() => reserve(s, p, [ids[1]], {})).toThrow("第1巡");
    withdraw(s, p);
    expect(reservationRoom(s, p)).toBe(1);
    reserve(s, p, [ids[1]], {});
    s.publicTurn.round = 2;
    reserve(s, p, [ids[0], ids[2], ids[3]], {});
    expect(eventProgress(s).materials).toBe(4);
    const other = addItem(s, s.players[1], "water");
    expect(() => reserve(s, s.players[1], [other.id], {})).toThrow("必要数");
    expect(s.players.every((p) => p.ap === 2)).toBe(true);
  });
  it("薬も能力値1ポイントも第1巡の上限対象、能力下限は維持", () => {
    const potions = game(7),
      p = potions.players[0];
    const ids = [
      addItem(potions, p, "watch").id,
      addItem(potions, p, "study").id,
    ];
    expect(() => reserve(potions, p, ids, {})).toThrow("第1巡");
    reserve(potions, p, [ids[0]], {});
    const s = game(6),
      q = s.players[0];
    expect(() => reserve(s, q, [], { attack: 1, defense: 1 })).toThrow("第1巡");
    reserve(s, q, [], { attack: 1 });
    expect(() => reserve(s, q, [], { defense: 1 })).toThrow("第1巡");
    withdraw(s, q);
    reserve(s, q, [], { defense: 1 });
    expect(reservationUnits(s, q)).toBe(1);
    s.publicTurn.round = 2;
    expect(() => reserve(s, q, [], { attack: q.stats.attack })).toThrow(
      "能力下限",
    );
  });
  it("4個イベントは第1巡でも埋まるが、独占時1人から最大4人に貢献機会が増える", () => {
    const fair = game();
    for (const p of fair.players)
      reserve(fair, p, [addItem(fair, p, "water").id], {});
    expect(eventProgress(fair).success).toBe(true);
    expect(new Set(fair.event.reservations.map((r) => r.player)).size).toBe(4);
    for (const p of fair.players) p.dailyGoal.id = 7;
    expect(
      fair.players.every((p) => dailyProgress(fair, p).status === "達成見込み"),
    ).toBe(true);
    resolveEvent(fair);
    expect(fair.players.every((p) => dailyAchieved(fair, p))).toBe(true);
    const unrestricted = game();
    unrestricted.publicTurn.round = 2;
    reserve(
      unrestricted,
      unrestricted.players[0],
      Array.from(
        { length: 4 },
        () => addItem(unrestricted, unrestricted.players[0], "water").id,
      ),
      {},
    );
    resolveEvent(unrestricted);
    expect(
      unrestricted.logs.filter((l) => l.type === "contribution"),
    ).toHaveLength(1);
  });
});

describe("v0.2.1 秘匿決闘の結果確認", () => {
  it.each(["win", "loss", "draw"])(
    "%s：OKまで停止、結果→報酬の順序、第三者は確認不可",
    (outcome) => {
      let s = game();
      s.phase = "duels";
      if (outcome === "win") {
        s.players[0].stats.attack = 99;
        s.players[0].stats.defense = 99;
      }
      if (outcome === "loss") {
        s.players[1].stats.attack = 99;
        s.players[1].stats.defense = 99;
      }
      startCombat(s, 1, 0, "secret");
      if (outcome === "win") s.combat!.hp = [1, 20];
      if (outcome === "loss") s.combat!.hp = [20, 1];
      if (outcome === "draw") s.combat!.rounds = [];
      for (let n = 0; s.combat && !s.combat.done && n < 5; n++) {
        if (outcome === "draw") {
          // Symmetric attack always does at least 1: one round cannot knock out at this HP.
          s.players[0].stats.attack = 3;
          s.players[1].stats.attack = 3;
          s.players[0].stats.defense = 999;
          s.players[1].stats.defense = 999;
          s.players[0].stats.insight = 1;
          s.players[1].stats.insight = 1;
        }
        s = dispatch(s, {
          type: "round",
          player: 0,
          stance: outcome === "win" ? "attack" : "defend",
        });
      }
      expect(s.combat?.done).toBe(true);
      expect(s.combat?.winner).toBe(
        outcome === "win" ? 0 : outcome === "loss" ? 1 : null,
      );
      expect(s.combat?.resultAcknowledged).toBe(false);
      expect(() => dispatch(s, { type: "advance" })).toThrow();
      expect(() =>
        dispatch(s, { type: "reward", player: 0, kind: "item" }),
      ).toThrow();
      expect(() => dispatch(s, { type: "combatAck", player: 2 })).toThrow();
      expect(
        s.logs
          .filter((l) => ["combat", "combatRound"].includes(l.type))
          .every((l) => JSON.stringify(l.audience) === "[1,0]"),
      ).toBe(true);
      s = dispatch(s, { type: "combatAck", player: 0 });
      if (outcome === "win") {
        expect(s.phase).toBe("rewards");
        s = dispatch(s, { type: "reward", player: 0, kind: "item" });
      }
      expect(s.combat).toBeUndefined();
      expect(s.phase).toBe("duels");
      expect(() => dispatch(s, { type: "combatAck", player: 0 })).toThrow();
    },
  );
  it("レシピ選択待ちが重なっても、戦闘報酬・結果確認を先に処理する", () => {
    let s = game();
    s.players[0].pendingRecipe = true;
    startCombat(s, 0, 1, "public");
    expect(simulationAction(s).type).toBe("round");
    s.combat!.done = true;
    s.combat!.winner = 0;
    expect(simulationAction(s).type).toBe("reward");
    s.combat!.kind = "secret";
    expect(simulationAction(s).type).toBe("combatAck");
  });
  it("結果確認待ちとOK後の保存・操作再生が一致", () => {
    const old = JSON.parse(serialize(createGame(setup)));
    old.state.rulesVersion = "browser-0.2+decisions-2";
    expect(() => deserialize(JSON.stringify(old))).toThrow(
      "バージョンが一致しません",
    );
    let s = createGame(setup),
      found = false;
    for (let n = 0; s.phase !== "ended" && n < 500; n++) {
      if (
        s.combat?.kind === "secret" &&
        s.combat.done &&
        !s.combat.resultAcknowledged
      ) {
        found = true;
        const saved = deserialize(serialize(s));
        expect(saved).toEqual(s);
        const a = { type: "combatAck" as const, player: 0 };
        expect(dispatch(saved, a)).toEqual(dispatch(s, a));
        expect(deserialize(serialize(dispatch(saved, a)))).toEqual(
          dispatch(s, a),
        );
        break;
      }
      s = dispatch(s, simulationAction(s));
    }
    expect(found).toBe(true);
  });
});

describe("v0.2.1 能力Lvと通知", () => {
  it.each([5, 8])("%iから1成長したら一度だけLv上昇を記録", (before) => {
    let s = game(3);
    s.players[0].stats.insight = before;
    addItem(s, s.players[0], "obsidian");
    addItem(s, s.players[0], "herb");
    s = dispatch(s, { type: "research", player: 0, stat: "insight" });
    const notices = s.logs.filter((l) => l.type === "levelUp" && l.actor === 0);
    expect(notices).toHaveLength(1);
    expect(notices[0].amount).toBe(before === 5 ? 2 : 3);
    expect(notices[0].text).toContain(
      before === 5 ? "持込枠 2" : "作成・持込を解禁",
    );
    s = dispatch(s, { type: "withdraw", player: 0 });
    expect(
      s.logs.filter((l) => l.type === "levelUp" && l.actor === 0),
    ).toHaveLength(1);
  });
  it("境界・次レベル・効果が一致し、上限Lvには次レベルなし", () => {
    expect([5, 6, 8, 9].map(level)).toEqual([1, 2, 2, 3]);
    expect([5, 6, 8, 9].map(nextLevel)).toEqual([6, 9, 9, null]);
    expect(levelEffect("attack", 2)).toContain("2");
    expect(levelEffect("defense", 3)).toContain("+3");
  });
});

describe("v0.2.1 日次HO見込み", () => {
  it("全24種の成立例を見込み表示でき、進捗は各上限で止まる", () => {
    const s = game(),
      p = s.players[0];
    for (const [type, amount] of [
      ["gather", 2],
      ["research", 2],
      ["brew", 1],
      ["acquirePotion", 1],
      ["contribution", 1],
      ["fp", 1],
      ["scout", 1],
      ["loot", 1],
      ["rest", 1],
      ["curseHit", 1],
      ["guard", 1],
      ["command", 1],
    ] as const)
      log(s, type, "成立例", {
        actor: 0,
        amount,
        kind: "event",
        audience: [0],
      });
    for (const target of [1, 2])
      log(s, "trade", "成立例", {
        actor: 0,
        target,
        amount: 1,
        data: { received: 0 },
        audience: [0, target],
      });
    for (const kind of ["public", "secret"] as const) {
      startCombat(s, 0, 1, kind);
      for (let n = 0; n < 5; n++)
        resolveRound(s, ["defend", "defend"], [undefined, undefined]);
      const c = s.combat!;
      c.winner = 0;
      c.rounds[0].damage = [1, 0];
      s.combatHistory.push(c);
      log(s, "combat", "成立例", {
        actor: 0,
        data: { id: c.id },
        audience: [0],
      });
    }
    s.combat = undefined;
    for (const goal of DAILY_GOALS) {
      p.dailyGoal.id = goal.id;
      expect(dailyAchieved(s, p), `HO${goal.id}`).toBe(true);
      const result = dailyProgress(s, p);
      expect(result.status, `HO${goal.id}`).toBe("達成見込み");
      expect(result.current, `HO${goal.id}`).toBe(result.total);
    }
  });
  it("全24種に有効な進捗を返し、他者の秘密を変更しても本人の表示は変わらない", () => {
    const s = game();
    for (const g of DAILY_GOALS) {
      s.players[0].dailyGoal.id = g.id;
      const before = dailyProgress(s, s.players[0]);
      expect(before.current).toBeGreaterThanOrEqual(0);
      expect(before.current).toBeLessThanOrEqual(before.total);
      s.players[1].longGoal.id = 25;
      s.players[1].magic = "shadow";
      expect(dailyProgress(s, s.players[0])).toEqual(before);
    }
  });
  it("取引は申請・不成立では進まず、異なる相手で1/2→2/2、最終判定で確定", () => {
    let s = game(3);
    s.players[0].dailyGoal.id = 9;
    expect(dailyProgress(s, s.players[0]).status).toBe("未達成");
    s = dispatch(s, {
      type: "trade",
      player: 0,
      target: 1,
      offer: [],
      request: { water: 999 },
    });
    expect(dailyProgress(s, s.players[0]).current).toBe(0);
    for (const target of [1, 2]) {
      const id = addItem(s, s.players[0], "water").id;
      s = dispatch(s, {
        type: "trade",
        player: 0,
        target,
        offer: [id],
        request: {},
      });
      expect(dailyProgress(s, s.players[0]).current).toBe(target);
    }
    expect(dailyProgress(s, s.players[0]).status).toBe("達成見込み");
    s.phase = "ho";
    s = dispatch(s, { type: "advance" });
    expect(dailyProgress(s, s.players[0]).status).toBe("達成確定");
    expect(
      s.logs.find((l) => l.type === "dailyHO" && l.actor === 0)?.text,
    ).toContain("日次HO達成！ FP+1");
    expect(
      s.logs.find((l) => l.type === "dailyHO" && l.actor === 0)?.audience,
    ).toEqual([0]);
  });
  it("納品HOは仮予約＋成功条件で見込み、取消・失敗で見込みを取り消す", () => {
    const s = game();
    s.publicTurn.round = 2;
    const p = s.players[0];
    p.dailyGoal.id = 7;
    const ids = Array.from({ length: 4 }, () => addItem(s, p, "water").id);
    reserve(s, p, ids, {});
    expect(dailyProgress(s, p).status).toBe("達成見込み");
    withdraw(s, p);
    expect(dailyProgress(s, p).status).toBe("未達成");
    reserve(s, p, [ids[0]], {});
    resolveEvent(s);
    expect(dailyProgress(s, p).status).toBe("未達成");
  });
  it("研究1/2から2/2、0成長は増えず、確定後のFPを二重報酬にしない", () => {
    const s = game(3),
      p = s.players[0];
    p.dailyGoal.id = 4;
    log(s, "research", "成長", { actor: 0, amount: 1 });
    expect(dailyProgress(s, p).current).toBe(1);
    log(s, "research", "成長なし", { actor: 0, amount: 0 });
    expect(dailyProgress(s, p).current).toBe(1);
    log(s, "research", "成長", { actor: 0, amount: 1 });
    expect(dailyProgress(s, p).status).toBe("達成見込み");
    const before = JSON.stringify(s);
    dailyProgress(s, p);
    dailyProgress(s, p);
    expect(JSON.stringify(s)).toBe(before);
  });
});
