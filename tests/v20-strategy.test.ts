import { describe, expect, it } from "vitest";
import { V20_RULES_VERSION } from "../src/domain/config";
import { drawEvent, eligibleEvents } from "../src/domain/events";
import { log } from "../src/domain/core";
import { addItem } from "../src/domain/items";
import { createGame, dispatch } from "../src/domain/reducer";
import {
  selectStrategy,
  strategyView,
  type StrategyCandidate,
} from "../src/domain/strategy";
import type { GameState } from "../src/domain/types";

const create = () =>
  createGame(
    {
      name: "アリア",
      seed: "v20-strategy",
      magic: "foresight",
      stats: { attack: 3, defense: 3, insight: 3 },
    },
    V20_RULES_VERSION,
  );

function aiTurn(event: number, failed: number) {
  const s = create();
  s.event.id = event;
  s.failed = failed;
  s.publicTurn.index = 1;
  s.players.forEach((p) => {
    p.stats = { attack: 3, defense: 3, insight: 3 };
    p.ai = p.id === 1;
    p.inventory = [];
  });
  s.players[1].longGoal = { id: 22, targets: [], achieved: false };
  s.players[1].dailyGoal = { id: 6, targets: [], achieved: false };
  return s;
}
const reasons = (s: GameState) =>
  s.logs.filter((l) => l.actor === 1 && l.type === "aiReason");

describe("v2.0 AIの優先順位", () => {
  it("通常は日次採集より長期研究を優先する", () => {
    const s = aiTurn(5, 1);
    for (const kind of ["obsidian", "crystal"]) addItem(s, s.players[1], kind);
    const next = dispatch(s, { type: "aiPublic" });
    expect(next.logs.some((l) => l.actor === 1 && l.type === "research")).toBe(
      true,
    );
    expect(reasons(next)[0]).toMatchObject({
      audience: "dev",
      data: { primary: "long", action: "research" },
    });
  });

  it("通算2失敗で必要な最後の研究を優先し、成功条件を満たしたら戻す", () => {
    const s = aiTurn(9, 2);
    s.players[1].longGoal = { id: 5, targets: [2], achieved: false };
    for (const kind of ["obsidian", "crystal"]) addItem(s, s.players[1], kind);
    for (let i = 0; i < 3; i++) log(s, "research", "", { actor: 0 });
    const next = dispatch(s, { type: "aiPublic" });
    expect(reasons(next).map((l) => l.data?.primary)).toEqual([
      "event",
      "long",
    ]);
    expect(reasons(next)[0].data?.action).toBe("research");
  });

  it("必要素材を確認できないとき、他人の所持内訳を推測して崩壊回避に切り替えない", () => {
    const s = aiTurn(5, 2);
    addItem(s, s.players[1], "herb");
    const otherwise = structuredClone(s);
    addItem(s, s.players[2], "water");
    addItem(otherwise, otherwise.players[2], "sand");
    const next = dispatch(s, { type: "aiPublic" });
    const nextOther = dispatch(otherwise, { type: "aiPublic" });
    expect(reasons(next)).toEqual(reasons(nextOther));
    expect(reasons(next)[0].data).toMatchObject({
      primary: "long",
      viableEvent: false,
    });
    expect(strategyView(s, 1).players[2]).not.toHaveProperty("longGoal");
    expect(strategyView(s, 1).players[2].inventory[0].kind).toBe("");
  });

  it("最後の夜に達成不能なL21より日次の偵察を優先する", () => {
    const s = aiTurn(5, 0);
    s.day = 8;
    s.phase = "night";
    const p = s.players[1];
    p.longGoal.id = 21;
    p.dailyGoal.id = 13;
    const candidates: StrategyCandidate[] = [
      { action: { type: "night", player: 1, choice: { kind: "rest" } } },
      {
        action: {
          type: "night",
          player: 1,
          choice: { kind: "scout", target: 2 },
        },
      },
    ];
    expect(selectStrategy(s, p, candidates, false)).toEqual(
      candidates[1].action,
    );
    expect(reasons(s).at(-1)?.data).toMatchObject({
      primary: "daily",
      impossible: true,
    });
  });

  it("効果が同じなら消費が少ない手を選び、完全同順位だけ固定シードで抽選する", () => {
    const s = aiTurn(5, 0);
    const p = s.players[1];
    const a: StrategyCandidate = {
      action: { type: "research", player: 1, stat: "attack" },
      cost: 3,
    };
    const b: StrategyCandidate = {
      action: { type: "research", player: 1, stat: "defense" },
      cost: 4,
    };
    const before = s.draws;
    expect(selectStrategy(s, p, [a, b], false)).toEqual(a.action);
    expect(s.draws).toBe(before);
    b.cost = 3;
    const copy = structuredClone(s);
    expect(selectStrategy(s, p, [a, b], false)).toEqual(
      selectStrategy(copy, copy.players[1], [a, b], false),
    );
    expect(s.draws).toBe(before + 1);
  });
});

function magicState(day: number, remaining: number[]) {
  const s = create();
  s.day = day;
  s.phase = "magic";
  s.event.resolved = true;
  s.event.acknowledged = true;
  s.usedEvents = Array.from({ length: 12 }, (_, i) => i + 1).filter(
    (id) => !remaining.includes(id),
  );
  s.players[0].magic = "foresight";
  return s;
}
describe("予知の候補と投票", () => {
  it("第4夜に第5日の重みで重複なしに引き、複数使用者で同じ候補を共有する", () => {
    const s = magicState(4, [1, 5, 6, 10, 11, 12]);
    s.players[1].magic = "foresight";
    const clone = structuredClone(s);
    const expected: number[] = [];
    for (let i = 0; i < 3; i++) expected.push(drawEvent(clone, 5, expected));
    const cast = dispatch(s, { type: "magic", player: 0 });
    expect(cast.foresight).toEqual(expected);
    expect(new Set(cast.foresight).size).toBe(3);
    expect(cast.usedEvents).toEqual(s.usedEvents);
    expect(() => dispatch(cast, { type: "magic", player: 1 })).toThrow(
      "自分の固有魔法だけを使用できます",
    );
    cast.players[1].ai = false;
    const shared = dispatch(cast, { type: "magic", player: 1 });
    expect(shared.foresight).toEqual(expected);
    expect(shared.draws).toBe(cast.draws);
    expect(shared.players.slice(0, 2).map((p) => p.availableDay)).toEqual([
      7, 7,
    ]);
  });

  it("候補2枚で全員1票、同票は最多候補だけから再現可能に抽選する", () => {
    let s = magicState(4, [5, 6]);
    s.players.forEach((p) => (p.ai = false));
    s = dispatch(s, { type: "magic", player: 0 });
    s = dispatch(s, { type: "advance" });
    expect(s.phase).toBe("vote");
    expect(() => dispatch(s, { type: "advance" })).toThrow("投票");
    for (let player = 0; player < 4; player++) {
      s = dispatch(s, { type: "vote", player, event: player < 2 ? 5 : 6 });
      expect(() => dispatch(s, { type: "vote", player, event: 5 })).toThrow(
        "投票不可",
      );
    }
    const before = s.draws;
    const result = dispatch(s, { type: "advance" });
    expect(result.nextEvent).toBe(dispatch(s, { type: "advance" }).nextEvent);
    expect([5, 6]).toContain(result.nextEvent);
    expect(result.draws).toBe(before + 1);
    expect(result.usedEvents).toEqual(s.usedEvents);
    let tomorrow = result;
    for (let i = 0; i < 3; i++)
      tomorrow = dispatch(tomorrow, { type: "advance" });
    expect(tomorrow.event.id).toBe(result.nextEvent);
    expect(eligibleEvents(tomorrow, 6).map((e) => e.id)).toEqual([
      result.nextEvent === 5 ? 6 : 5,
    ]);
  });

  it("候補1枚は即採用、0枚と第8日は使用不可", () => {
    const s = magicState(7, [11]);
    const cast = dispatch(s, { type: "magic", player: 0 });
    const adopted = dispatch(cast, { type: "advance" });
    expect(adopted.phase).toBe("night");
    expect(adopted.nextEvent).toBe(11);
    expect(adopted.players[0].availableDay).toBe(10);
    const none = magicState(7, []);
    expect(() => dispatch(none, { type: "magic", player: 0 })).toThrow(
      "候補がありません",
    );
    expect(none.players[0].availableDay).toBe(1);
    expect(() =>
      dispatch(magicState(8, [11]), { type: "magic", player: 0 }),
    ).toThrow("第8日は使用不可");
  });
});

it("E06の不足4点を公開能力で1・2・1点に分けられるなら、長期HOの決闘より先に予約する", () => {
  const s = aiTurn(6, 2);
  s.publicTurn.round = 2;
  for (const [id, capacity] of [
    [1, 1],
    [2, 2],
    [3, 1],
  ]) {
    s.players[id].stats = { attack: capacity + 1, defense: 1, insight: 1 };
    s.players[id].ap = 1;
    s.players[id].ai = true;
    s.players[id].longGoal = {
      id: 5,
      targets: [id === 1 ? 2 : 1],
      achieved: false,
    };
  }
  const next = dispatch(s, { type: "aiPublic" });
  expect(reasons(next)[0].data).toMatchObject({
    primary: "event",
    action: "reserve",
    viableEvent: true,
  });
  expect(
    next.logs
      .filter((l) => l.type === "reserve")
      .slice(0, 3)
      .map((l) => l.data?.units),
  ).toEqual([1, 2, 1]);
  expect(next.event.success).toBe(true);
  expect(next.failed).toBe(2);
});

it("残り手番がない魔女の納品余力は合算しない", () => {
  const s = aiTurn(6, 2);
  s.publicTurn.round = 2;
  s.publicTurn.index = 3;
  s.players[1].ai = false;
  const p = s.players[3];
  p.ai = true;
  p.stats = { attack: 2, defense: 1, insight: 1 };
  p.longGoal = { id: 5, targets: [0], achieved: false };
  const next = dispatch(s, { type: "aiPublic" });
  expect(
    next.logs.find((l) => l.actor === 3 && l.type === "aiReason")?.data,
  ).toMatchObject({ primary: "long", viableEvent: false });
});
