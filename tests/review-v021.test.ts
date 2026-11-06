import { describe, it, expect } from "vitest";
import { createGame, dispatch } from "../src/domain/reducer";
import { automaticLoadout } from "../src/domain/combat";
import { addItem } from "../src/domain/items";
import { reserve, withdraw, eventProgress } from "../src/domain/events";
import { dailyProgress, dailyAchieved } from "../src/domain/ho";
import { log } from "../src/domain/core";
import { serialize, deserialize } from "../src/domain/persistence";
const setup = {
  name: "アリア",
  seed: "review-regression",
  magic: "barrier" as const,
  stats: { attack: 3, defense: 4, insight: 3 },
};
function game(event = 12) {
  const s = createGame(setup);
  s.event = {
    id: event,
    specified: "water",
    reservations: [],
    mock: [],
    resolved: false,
  };
  s.players[0].dailyGoal.id = 7;
  return s;
}
describe("PR #1 P1 戦闘薬の持込資格", () => {
  it.each([5, 8, 9])(
    "洞察%i：所持可能だが自動持込はLv3だけ、ロック品も除外",
    (insight) => {
      const s = game(),
        p = s.players[1];
      p.stats.insight = insight;
      const id = addItem(s, p, "strike").id;
      const locked = addItem(s, p, "iron");
      p.inventory.find((i) => i.id === locked.id)!.lock = "event";
      addItem(s, p, "watch");
      expect(automaticLoadout(p)).toEqual(insight < 9 ? [] : [id]);
      expect(p.inventory.some((i) => i.id === id)).toBe(true);
    },
  );
  it.each([5, 8])(
    "人間対AI：洞察%iのAIが戦闘薬を持っていても戦闘が完了する",
    (insight) => {
      let s = game(4);
      s.players[1].stats.insight = insight;
      const id = addItem(s, s.players[1], "strike").id;
      s = dispatch(s, { type: "duel", player: 0, target: 1, mock: true });
      for (let n = 0; s.combat && n < 5; n++) {
        expect(s.combat.brought[1]).toEqual([]);
        s = dispatch(s, { type: "round", player: 0, stance: "defend" });
      }
      expect(s.combat).toBeUndefined();
      expect(s.combatHistory).toHaveLength(1);
      expect(
        s.combatHistory[0].rounds.every((r) => r.potions[1] === null),
      ).toBe(true);
      expect(s.players[1].inventory.some((i) => i.id === id)).toBe(true);
    },
  );
  it.each([
    [5, 5],
    [8, 8],
    [5, 8],
  ])("AI同士：洞察%i/%iが両者とも薬を所持しても秘匿決闘が終了する", (a, b) => {
    let s = game();
    s.phase = "duels";
    s.players[1].stats.insight = a;
    s.players[2].stats.insight = b;
    const ids = [
      addItem(s, s.players[1], "strike").id,
      addItem(s, s.players[2], "focus").id,
    ];
    s.duelQueue = [[1, 2]];
    s = dispatch(s, { type: "advance" });
    expect(s.phase).toBe("results");
    expect(s.combat).toBeUndefined();
    expect(s.combatHistory[0].done).toBe(true);
    expect(
      s.combatHistory[0].rounds.every((r) =>
        r.potions.every((p) => p === null),
      ),
    ).toBe(true);
    expect(s.logs.filter((l) => l.type === "usePotion")).toHaveLength(0);
    const owned = s.players.flatMap((p) => p.inventory.map((i) => i.id));
    expect(ids.every((id) => owned.includes(id))).toBe(true);
  });
});

describe("PR #1 P2 崩壊時のHO表示", () => {
  it("達成条件を満たしていても最終判定なしなら見込みを終了し、報酬を付与しない", () => {
    let s = game(1);
    s.failed = 2;
    s.publicTurn.round = 4;
    s.players[0].dailyGoal.id = 1;
    s.players[0].fp = 2;
    log(s, "research", "研究成功", { actor: 0, amount: 1 });
    expect(dailyProgress(s, s.players[0]).status).toBe("達成見込み");
    const beforeFP = s.players.map((p) => p.fp);
    s = dispatch(s, { type: "advance" });
    expect(s.result?.reason).toBe("collapse");
    expect(s.failed).toBe(3);
    expect(dailyProgress(s, s.players[0]).status).toBe("判定なし・報酬なし");
    expect(dailyProgress(s, s.players[0]).detail).toContain("最終判定されず");
    expect(s.players.every((p) => p.dailyHistory.length === 0)).toBe(true);
    expect(s.players.map((p) => p.fp)).toEqual(beforeFP);
    expect(
      s.logs.some(
        (l) => l.type === "dailyHO" || (l.type === "fp" && l.kind === "ho"),
      ),
    ).toBe(false);
  });
  it("通常のHO判定・FP付与は変えず、達成確定を表示する", () => {
    let s = game(1);
    s.phase = "ho";
    s.players[0].dailyGoal.id = 1;
    log(s, "research", "研究成功", { actor: 0, amount: 1 });
    const before = s.players[0].fp;
    s = dispatch(s, { type: "advance" });
    expect(dailyProgress(s, s.players[0]).status).toBe("達成確定");
    expect(s.players[0].fp).toBe(before + 1);
    expect(s.players[0].dailyHistory[0].achieved).toBe(true);
  });
});

describe("PR #1 P3 二択イベントの貢献候補", () => {
  it.each([7, 11])(
    "HO%i：未確定ルートの素材予約を進捗へ反映し、材料ルート確定と取消に追従",
    (goal) => {
      const s = game(),
        p = s.players[0];
      p.dailyGoal.id = goal;
      s.publicTurn.round = 2;
      const id = addItem(s, p, "water").id;
      reserve(s, p, [id], {});
      expect(s.event.route).toBeUndefined();
      expect(dailyProgress(s, p).current).toBe(1);
      expect(dailyProgress(s, p).status).toBe("未達成");
      expect(dailyAchieved(s, p)).toBe(false);
      if (goal === 11) log(s, "gather", "採集", { actor: 0, amount: 2 });
      reserve(
        s,
        s.players[1],
        Array.from({ length: 7 }, () => addItem(s, s.players[1], "water").id),
        {},
      );
      expect(s.event.route).toBe("materials");
      expect(eventProgress(s).success).toBe(true);
      expect(dailyProgress(s, p).status).toBe("達成見込み");
      withdraw(s, p);
      expect(s.event.route).toBeUndefined();
      expect(dailyProgress(s, p).status).toBe("未達成");
      expect(dailyProgress(s, p).current).toBe(goal === 11 ? 1 : 0);
      reserve(s, p, [id], {});
      expect(dailyProgress(s, p).status).toBe("達成見込み");
    },
  );
  it("能力ルートが先に成立したら、素材のみ予約した本人は貢献候補から外れる", () => {
    const s = game(),
      p = s.players[0];
    s.publicTurn.round = 2;
    reserve(s, p, [addItem(s, p, "water").id], {});
    expect(dailyProgress(s, p).current).toBe(1);
    s.players[1].stats.attack = 6;
    reserve(s, s.players[1], [], { attack: 5 });
    expect(s.event.route).toBe("stats");
    expect(eventProgress(s).success).toBe(true);
    expect(dailyProgress(s, p).current).toBe(0);
    expect(dailyProgress(s, p).status).toBe("未達成");
    withdraw(s, s.players[1]);
    expect(s.event.route).toBeUndefined();
    expect(dailyProgress(s, p).current).toBe(1);
    expect(dailyProgress(s, p).status).toBe("未達成");
  });
});

describe("再レビュー修正後の保存識別", () => {
  it("現在版は完全再生し、修正前のルール版は明示的に拒否する", () => {
    const s = createGame(setup);
    expect(deserialize(serialize(s))).toEqual(s);
    const old = JSON.parse(serialize(s));
    old.state.rulesVersion = "browser-0.2.1+decisions-3";
    expect(() => deserialize(JSON.stringify(old))).toThrow(
      "バージョンが一致しません",
    );
  });
});
