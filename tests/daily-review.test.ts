import { expect, it } from "vitest";
import {
  V20_PREVIOUS_RULES_VERSION,
  V20_RULES_VERSION,
} from "../src/domain/config";
import { createGame, dispatch } from "../src/domain/reducer";
import { simulationAction } from "../src/domain/simulation";
import { deserialize, serialize } from "../src/domain/persistence";
import { addItem } from "../src/domain/items";
import {
  dailyReview,
  itemChanges,
  fpChanges,
  inventoryCounts,
} from "../src/ui/dailyReview";
const setup = {
  name: "アリア",
  seed: "review-1",
  magic: "barrier",
  stats: { attack: 3, defense: 3, insight: 3 },
} as const;

for (const version of [V20_PREVIOUS_RULES_VERSION, V20_RULES_VERSION]) {
  it(`reconciles each full day including public and private changes, without changing saved state (${version})`, () => {
    let s = createGame(setup, version);
    let days = 0;
    const starts = new Map([
      [
        1,
        { items: inventoryCounts(s.players[0].inventory), fp: s.players[0].fp },
      ],
    ]);
    for (let i = 0; i < 300 && !s.result; i++) {
      const action = simulationAction(s);
      s = dispatch(
        s,
        action.type === "advance" ? { ...action, pauseAtDawn: true } : action,
      );
      if (!starts.has(s.day))
        starts.set(s.day, {
          items: inventoryCounts(s.players[0].inventory),
          fp: s.players[0].fp,
        });
      if (s.phase !== "dawn" && s.result?.reason !== "completed") continue;
      days++;
      const original = serialize(s);
      const result = dailyReview(s);
      expect(result.error).toBe("");
      expect(result.inventoryStart).toEqual(starts.get(s.day)!.items);
      expect(result.fpStart).toBe(starts.get(s.day)!.fp);
      expect(result.inventoryEnd).toEqual(
        inventoryCounts(s.players[0].inventory),
      );
      for (const [kind, total] of Object.entries(result.totals)) {
        expect(
          result.items
            .filter((row) => row.kind === kind)
            .reduce((sum, row) => sum + row.amount, 0),
        ).toBe(total);
      }
      expect(
        result.items.filter((row) => row.cause === "内訳記録のない増減"),
      ).toEqual([]);
      expect(result.fpEntries.reduce((sum, row) => sum + row.amount, 0)).toBe(
        result.fpEnd - result.fpStart,
      );
      expect(serialize(s)).toBe(original);
      expect(dailyReview(deserialize(original))).toEqual(result);
    }
    expect(days).toBe(8);
  });
}

it("keeps both sides of a same-kind purchase, instead of only showing the net count", () => {
  let s = createGame(setup, V20_PREVIOUS_RULES_VERSION);
  s.players[0].inventory = [];
  for (let i = 0; i < 3; i++) addItem(s, s.players[0], "sand");
  const action = {
    type: "shop",
    player: 0,
    items: s.players[0].inventory.map((i) => i.id),
    receive: "sand",
  } as const;
  const after = dispatch(s, { ...action, items: [...action.items] });
  expect(
    itemChanges(s, after, { ...action, items: [...action.items] }, 1),
  ).toEqual([
    { cause: "公開行動・購買", kind: "sand", amount: -3 },
    { cause: "公開行動・購買", kind: "sand", amount: 1 },
  ]);
});

it("records a selected public potion once, not again each time its effect applies", () => {
  let s = createGame(setup, V20_PREVIOUS_RULES_VERSION);
  const item = addItem(s, s.players[0], "abundance");
  const activate = { type: "usePotion", player: 0, item: item.id } as const;
  const active = dispatch(s, activate);
  expect(itemChanges(s, active, activate, 1)).toEqual([
    { cause: "公開行動・薬の使用", kind: "abundance", amount: -1 },
  ]);
  const gather = { type: "gather", player: 0 } as const;
  const after = dispatch(active, gather);
  expect(
    itemChanges(active, after, gather, 1).some(
      (row) => row.kind === "abundance",
    ),
  ).toBe(false);
});

it("shows an unknown cause as unattributed, rather than guessing from secret records", () => {
  const before = createGame(setup, V20_PREVIOUS_RULES_VERSION);
  const after = structuredClone(before);
  addItem(after, after.players[0], "sand");
  after.logs.push({
    seq: after.logs.length + 1,
    day: 1,
    phase: "night",
    type: "loot",
    kind: "sand",
    actor: 1,
    target: 2,
    amount: 1,
    audience: [1, 2],
    text: "他者の秘密",
  });
  const rows = itemChanges(before, after, { type: "advance" }, 1);
  expect(rows).toEqual([
    { cause: "内訳記録のない増減", kind: "sand", amount: 1 },
  ]);
});

it("labels loot loss without identifying the attacker", () => {
  const before = createGame(setup, V20_PREVIOUS_RULES_VERSION);
  const after = structuredClone(before);
  const item = after.players[0].inventory.pop()!;
  after.logs.push({
    seq: after.logs.length + 1,
    day: 1,
    phase: "rewards",
    type: "loot",
    kind: item.kind,
    actor: 1,
    target: 0,
    amount: 1,
    audience: [1, 0],
    text: "強奪",
  });
  expect(itemChanges(before, after, { type: "advance" }, 1)).toEqual([
    { cause: "夜間行動・強奪被害", kind: item.kind, amount: -1 },
  ]);
});

it("keeps FP losses and gains separate and excludes other players' rewards", () => {
  const entry = {
    seq: 1,
    day: 1,
    phase: "ho",
    type: "fp",
    audience: [0],
    text: "",
    actor: 0,
  } as const;
  const logs = [
    { ...entry, audience: [0], amount: 1, kind: "ho" },
    { ...entry, audience: [0], seq: 2, amount: -2, kind: "scout" },
    { ...entry, audience: [1], seq: 3, actor: 1, amount: 9, kind: "ho" },
  ];
  expect(fpChanges(logs, 1)).toEqual([
    { seq: 1, cause: "今日の課題達成", amount: 1 },
    { seq: 2, cause: "夜間行動による名声減少", amount: -2 },
  ]);
});

it("keeps both directions of an incoming trade without double-counting participant logs", () => {
  const before = createGame(setup, V20_PREVIOUS_RULES_VERSION);
  before.players[0].inventory = [{ id: 901, kind: "water" }];
  const after = structuredClone(before);
  after.players[0].inventory = [{ id: 902, kind: "sand" }];
  const seq = after.logs.length + 1;
  for (const [offset, actor, target] of [
    [0, 1, 0],
    [1, 0, 1],
  ])
    after.logs.push({
      seq: seq + offset,
      day: 1,
      phase: "public",
      type: "trade",
      actor,
      target,
      audience: [0, 1],
      text: "取引成立",
      data: { offered: ["sand"], receivedKinds: ["water"] },
    });
  expect(
    itemChanges(
      before,
      after,
      { type: "tradeReply", player: 0, id: 1, accept: true },
      1,
    ),
  ).toEqual([
    { cause: "公開行動・取引", kind: "sand", amount: 1 },
    { cause: "公開行動・取引", kind: "water", amount: -1 },
  ]);
});

it("retains creation and loss of the same potion within one confirmed operation", () => {
  const before = createGame(setup, V20_PREVIOUS_RULES_VERSION);
  before.players[0].inventory = [
    { id: 901, kind: "herb" },
    { id: 902, kind: "herb" },
  ];
  const after = structuredClone(before);
  after.players[0].inventory = [];
  after.logs.push({
    seq: after.logs.length + 1,
    day: 1,
    phase: "night",
    type: "brew",
    actor: 0,
    kind: "abundance",
    audience: [0],
    text: "豊穣の薬を作成",
  });
  after.logs.push({
    seq: after.logs.length + 1,
    day: 1,
    phase: "rewards",
    type: "loot",
    actor: 1,
    target: 0,
    kind: "abundance",
    amount: 1,
    audience: [0, 1],
    text: "強奪",
  });
  expect(itemChanges(before, after, { type: "advance" }, 1)).toEqual([
    { cause: "夜間行動・調合", kind: "herb", amount: -2 },
    { cause: "夜間行動・調合", kind: "abundance", amount: 1 },
    { cause: "夜間行動・強奪被害", kind: "abundance", amount: -1 },
  ]);
});
