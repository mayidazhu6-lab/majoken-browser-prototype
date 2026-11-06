import { describe, it, expect } from "vitest";
import { createGame, dispatch, currentPlayer } from "../src/domain/reducer";
import {
  startCombat,
  resolveRound,
  legalStances,
  chooseStance,
} from "../src/domain/combat";
import { addItem, materialIds, RECIPES } from "../src/domain/items";
import { MATERIALS, RESEARCH, STATS } from "../src/domain/config";
import { simulationAction } from "../src/domain/simulation";
import { deserialize, serialize, replay } from "../src/domain/persistence";
import { pick } from "../src/domain/rng";
const setup = {
  name: "検証",
  seed: "v022",
  magic: "barrier" as const,
  stats: { attack: 4, defense: 3, insight: 3 },
};
function game() {
  const s = createGame(setup);
  s.event = {
    id: 1,
    specified: "dew",
    reservations: [],
    mock: [],
    resolved: false,
  };
  for (const p of s.players.slice(1)) {
    p.dailyGoal.id = 6;
    p.longGoal.id = 21;
  }
  return s;
}
describe("v0.2.2 ためる・幻惑の実行行動を基準に制限", () => {
  it.each([0, 1])(
    "席%iは強化を1回だけ使用し連続・最終Rためるを拒否",
    (side) => {
      const s = game();
      const c = startCombat(s, 0, 1, "secret");
      const choices =
        side === 0
          ? (["charge", "defend"] as const)
          : (["defend", "charge"] as const);
      resolveRound(s, [...choices], [undefined, undefined]);
      const bonus = c.charge[side];
      expect(bonus).toBeGreaterThan(0);
      expect(() =>
        resolveRound(s, [...choices], [undefined, undefined]),
      ).toThrow("連続");
      resolveRound(s, ["defend", "defend"], [undefined, undefined]);
      expect(c.rounds[1].chargeBonus[side]).toBe(bonus);
      expect(c.charge[side]).toBe(0);
      resolveRound(s, ["defend", "defend"], [undefined, undefined]);
      expect(c.rounds[2].chargeBonus[side]).toBe(0);
      resolveRound(s, ["defend", "defend"], [undefined, undefined]);
      expect(legalStances(c, side)).not.toContain("charge");
      expect(() =>
        resolveRound(s, [...choices], [undefined, undefined]),
      ).toThrow("最終");
      resolveRound(s, ["defend", "defend"], [undefined, undefined]);
      expect(c.done).toBe(true);
    },
  );
  it("幻惑がためるへ変更した場合も次Rでは拒否し、禁止されたためるへ変更しない", () => {
    let changed = false;
    for (let n = 0; n < 30; n++) {
      const s = createGame({ ...setup, seed: `illusion-${n}` });
      const c = startCombat(s, 0, 1, "secret");
      c.illusionRound = 0;
      resolveRound(s, ["defend", "defend"], [undefined, undefined]);
      expect(c.previous).toEqual(c.rounds[0].choices);
      if (c.previous[1] === "charge") {
        changed = true;
        expect(c.rounds[0].original[1]).toBe("defend");
        expect(() =>
          resolveRound(s, ["defend", "charge"], [undefined, undefined]),
        ).toThrow();
      }
      const s2 = game();
      const c2 = startCombat(s2, 0, 1, "secret");
      c2.previous[1] = "charge";
      c2.charge[1] = 12;
      c2.illusionRound = 0;
      resolveRound(s2, ["defend", "defend"], [undefined, undefined]);
      expect(c2.rounds[0].choices[1]).toBe("attack");
      expect(c2.charge[1]).toBe(0);
    }
    expect(changed).toBe(true);
  });
  it("AIは直前ためる・最終Rでためるを選ばない（能力差・双方の視点）", () => {
    for (const own of [
      { attack: 2, defense: 2, insight: 12 },
      { attack: 8, defense: 3, insight: 3 },
    ])
      for (const opponent of [
        { attack: 2, defense: 8, insight: 3 },
        { attack: 6, defense: 2, insight: 9 },
      ]) {
        expect(
          chooseStance(own, opponent, 12, 0, "charge", [20, 20], [], 4),
        ).not.toBe("charge");
        expect(
          chooseStance(own, opponent, 0, 0, null, [20, 20], [], 1),
        ).not.toBe("charge");
      }
  });
});
describe("v0.2.2 研究・6素材", () => {
  it("研究3種は既存6素材の互いに重ならない2個ずつ、薬レシピは維持", () => {
    expect(Object.values(RESEARCH).flat()).toEqual(MATERIALS);
    expect(new Set(Object.values(RESEARCH).flat()).size).toBe(6);
    expect(RECIPES.find((r) => r.id === "focus")!.materials).toEqual([
      "sand",
      "water",
    ]);
    expect(RECIPES.find((r) => r.id === "talent")!.materials).toHaveLength(5);
  });
  it.each(STATS)(
    "%s研究は専用2種各1消費、1AP・成長+1、片方不足は拒否",
    (stat) => {
      let s = game();
      const p = s.players[0];
      p.inventory = [];
      const ids = RESEARCH[stat].map((k) => addItem(s, p, k).id);
      expect(materialIds(p, RESEARCH[stat])).toEqual(ids);
      const before = p.stats[stat];
      s = dispatch(s, { type: "research", player: 0, stat });
      expect(s.players[0].stats[stat]).toBe(before + 1);
      expect(s.players[0].ap).toBe(1);
      expect(s.players[0].inventory).toHaveLength(0);
      const short = game();
      short.players[0].inventory = [];
      addItem(short, short.players[0], RESEARCH[stat][0]);
      expect(() =>
        dispatch(short, { type: "research", player: 0, stat }),
      ).toThrow("素材不足");
    },
  );
  it("採集と同じ抽選を6万回行い6種類が各1/6付近に出る", () => {
    const s = game();
    const counts = Object.fromEntries(MATERIALS.map((k) => [k, 0]));
    for (let n = 0; n < 60000; n++) {
      counts[pick(s, MATERIALS, "採集素材")]++;
      if (n % 100 === 0) s.logs = [];
    }
    for (const n of Object.values(counts))
      expect(Math.abs(n - 10000)).toBeLessThan(500);
  });
});
describe("v0.2.2 納品・自動確定と確認待ち", () => {
  it("第1巡取消で枠回復、第2巡は追加可能、他の魔女との先着順を維持", () => {
    let s = game();
    const p = s.players[0];
    p.inventory = [];
    const ids = Array.from({ length: 4 }, () => addItem(s, p, "dew").id);
    s = dispatch(s, { type: "reserve", player: 0, items: [ids[0]], stats: {} });
    expect(() =>
      dispatch(s, { type: "reserve", player: 0, items: [ids[1]], stats: {} }),
    ).toThrow("第1巡");
    s = dispatch(s, { type: "withdraw", player: 0 });
    s = dispatch(s, { type: "reserve", player: 0, items: [ids[1]], stats: {} });
    s = dispatch(s, { type: "endTurn", player: 0 });
    expect(s.publicTurn.round).toBe(2);
    expect(s.event.reservations.flatMap((r) => r.items)).toHaveLength(4);
    expect(() =>
      dispatch(s, { type: "reserve", player: 0, items: [ids[2]], stats: {} }),
    ).toThrow("必要数");
    s = dispatch(s, { type: "withdraw", player: 0 });
    s = dispatch(s, { type: "reserve", player: 0, items: [ids[2]], stats: {} });
    s = dispatch(s, { type: "endTurn", player: 0 });
    expect(s.event.resolved).toBe(true);
    expect(s.event.success).toBe(true);
    expect(s.event.finalProgress?.materials).toBe(4);
    expect(() => dispatch(s, { type: "advance" })).toThrow("結果を確認");
    expect(() => dispatch(s, { type: "withdraw", player: 0 })).toThrow(
      "結果を確認",
    );
    const fp = s.players[0].fp;
    s = dispatch(s, { type: "eventAck", player: 0 });
    expect(s.players[0].fp).toBe(fp);
    expect(s.event.acknowledged).toBe(true);
  });
  it("第2巡の残り枠へ複数納品でき、所持不足・対象外・手番外を明示して拒否", () => {
    let s = game();
    s.publicTurn.round = 2;
    s.players[0].inventory = [];
    const ids = Array.from(
      { length: 3 },
      () => addItem(s, s.players[0], "dew").id,
    );
    s = dispatch(s, { type: "reserve", player: 0, items: ids, stats: {} });
    expect(s.event.reservations[0].items).toHaveLength(3);
    expect(() =>
      dispatch(s, { type: "reserve", player: 0, items: [99999], stats: {} }),
    ).toThrow("所持不足");
    const potion = addItem(s, s.players[0], "vigor");
    expect(() =>
      dispatch(s, {
        type: "reserve",
        player: 0,
        items: [potion.id],
        stats: {},
      }),
    ).toThrow("対象外");
    expect(() =>
      dispatch(s, { type: "reserve", player: 1, items: [], stats: {} }),
    ).toThrow("手番");
  });
  it("合法な全日履歴でイベント結果確認待ちを保存・再生でき、報酬二重付与なし", () => {
    let s = createGame(setup);
    let checks = 0;
    for (let n = 0; s.phase !== "ended" && n < 500; n++) {
      if (s.event.resolved && !s.event.acknowledged) {
        const saved = deserialize(serialize(s));
        expect(saved).toEqual(s);
        expect(replay(s.setup, s.actions)).toEqual(s);
        const next = dispatch(saved, { type: "eventAck", player: 0 });
        expect(next.players.map((p) => p.fp)).toEqual(
          s.players.map((p) => p.fp),
        );
        expect(() => dispatch(next, { type: "eventAck", player: 0 })).toThrow();
        checks++;
      }
      s = dispatch(s, simulationAction(s));
    }
    expect(checks).toBeGreaterThan(0);
    expect(s.phase).toBe("ended");
  }, 15000);
});
describe("v0.2.2 連夜襲撃・公開決闘報酬・卒業順位", () => {
  it.each([0, 1])(
    "人間/AI席%iとも前夜襲撃済みでも今夜も確定できる",
    (player) => {
      let s = game();
      s.phase = "night";
      s.players[player].lastRaid = s.day - 1;
      s = dispatch(s, {
        type: "night",
        player,
        choice: { kind: "raid", target: player === 0 ? 1 : 0 },
      });
      expect(s.players[player].night?.kind).toBe("raid");
      expect(() =>
        dispatch(s, {
          type: "night",
          player,
          choice: { kind: "raid", target: 2 },
        }),
      ).toThrow("確定済み");
    },
  );
  it.each([0, 1, null])(
    "公開決闘結果%s：1APで勝者だけ1FP、能力移転なし、確認後第2巡で残APを使用",
    (winner) => {
      let s = game();
      s = dispatch(s, { type: "duel", player: 0, target: 1 });
      expect(s.players[0].ap).toBe(1);
      expect(s.players[1].ap).toBe(2);
      const before = s.players.map((p) => ({ ...p.stats }));
      for (let n = 0; n < 4; n++)
        resolveRound(s, ["defend", "defend"], [undefined, undefined]);
      s.combat!.hp =
        winner === null ? [0, 0] : winner === 0 ? [20, 0] : [0, 20];
      s = dispatch(s, { type: "round", player: 0, stance: "defend" });
      expect(s.combat?.done).toBe(true);
      expect(s.combat?.winner).toBe(winner);
      expect(s.players.map((p) => p.fp)).toEqual(
        winner === null
          ? [0, 0, 0, 0]
          : winner === 0
            ? [1, 0, 0, 0]
            : [0, 1, 0, 0],
      );
      expect(() =>
        dispatch(s, {
          type: "reward",
          player: 0,
          kind: "item",
          stat: "attack",
        }),
      ).toThrow();
      s = dispatch(s, { type: "combatAck", player: 0 });
      expect(s.combat).toBeUndefined();
      expect(s.players.map((p) => p.stats)).toEqual(before);
      s = dispatch(s, { type: "endTurn", player: 0 });
      expect(currentPlayer(s)).toBe(0);
      expect(s.publicTurn.round).toBe(2);
      s = dispatch(s, { type: "gather", player: 0 });
      expect(s.players[0].ap).toBe(0);
    },
  );
  it("降参はアイテム移動のみ、双方FPなしでOKまで停止", () => {
    let s = game();
    s.publicTurn.index = 1;
    s = dispatch(s, { type: "duel", player: 1, target: 0 });
    const ids = s.players[0].inventory.slice(0, 2).map((i) => i.id);
    s = dispatch(s, {
      type: "challengeReply",
      player: 0,
      fight: false,
      items: ids,
    });
    expect(s.publicOutcome).toBeDefined();
    expect(s.players.every((p) => p.fp === 0)).toBe(true);
    expect(s.combatHistory).toHaveLength(0);
    expect(() => dispatch(s, { type: "endTurn", player: 1 })).toThrow(
      "降参の結果",
    );
    s = dispatch(s, { type: "publicOutcomeAck", player: 0 });
    expect(s.publicOutcome).toBeUndefined();
  });
  it("卒業者だけがFP順位、非卒業高FPを除外、日次HO数で順位を変えず同率は競技順位", () => {
    let s = game();
    s.day = 8;
    s.phase = "ho";
    for (const p of s.players) {
      p.longGoal = { id: 2, targets: [0], achieved: p.id !== 0 };
      p.dailyGoal.id = 3;
      p.fp = p.id === 0 ? 100 : p.id === 3 ? 2 : 5;
      p.dailyHistory = [];
    }
    s.players[3].dailyHistory = Array.from({ length: 7 }, (_, i) => ({
      day: i + 1,
      id: 1,
      achieved: true,
    }));
    s = dispatch(s, { type: "advance" });
    expect(s.result?.graduates).toEqual([1, 2, 3]);
    expect(s.result?.chiefs).toEqual([1, 2]);
    expect(s.result?.ranking.map((r) => r.rank)).toEqual([null, 1, 1, 3]);
  });
});
