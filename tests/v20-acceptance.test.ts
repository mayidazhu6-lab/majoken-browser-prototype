import { describe, expect, it } from "vitest";
import { startCombat } from "../src/domain/combat";
import { V20_RULES_VERSION } from "../src/domain/config";
import { log } from "../src/domain/core";
import { EVENTS, reserve, resolveEvent, withdraw } from "../src/domain/events";
import {
  DAILY_GOALS,
  LONG_GOALS,
  dailyAchieved,
  longAchieved,
} from "../src/domain/ho";
import { addItem } from "../src/domain/items";
import { createGame, dispatch } from "../src/domain/reducer";
import type { Combat, GameState, Goal, Log, Stat } from "../src/domain/types";

const game = () =>
  createGame(
    {
      name: "アリア",
      seed: "v20-acceptance",
      magic: "barrier",
      stats: { attack: 3, defense: 3, insight: 3 },
    },
    V20_RULES_VERSION,
  );
type Scenario = (s: GameState) => void;
type Cases = [
  成立: Scenario,
  不成立: Scenario,
  境界: Scenario,
  境界の期待値?: boolean,
];
const fact = (s: GameState, type: string, fields: Partial<Log> = {}) =>
  log(s, type, type, { actor: 0, ...fields });
const trade = (s: GameState, target = 1, amount = 1, received = 0) =>
  fact(s, "trade", { target, amount, data: { received } });
const scout = (s: GameState, target = 1, day = s.day) =>
  fact(s, "scout", { target, day, amount: 1 });
function battle(
  s: GameState,
  kind: Combat["kind"] = "public",
  winner: number | null = 0,
  pair: [number, number] = [0, 1],
) {
  const c = startCombat(s, pair[0], pair[1], kind);
  c.done = true;
  c.winner = winner;
  s.combatHistory.push(c);
  s.combat = undefined;
  for (const actor of pair) fact(s, "combat", { actor, data: { id: c.id } });
  if (winner !== null && kind !== "mock")
    fact(s, "win", {
      actor: winner,
      target: pair.find((id) => id !== winner),
      data: { kind, initiator: pair[0], initiated: pair[0] === winner },
    });
  return c;
}
function round(c: Combat, element: Stat, dealt = 1, received = 1) {
  c.elemental!.rounds.push({
    sides: [
      {
        element,
        affinity: 0,
        levelBonus: 0,
        potionBonus: 0,
        calculated: 3,
        dealt,
      },
      {
        element: "attack",
        affinity: 0,
        levelBonus: 0,
        potionBonus: 0,
        calculated: 3,
        dealt: received,
      },
    ],
    hp: [0, 0],
  });
}
const triple = (
  s: GameState,
  kind: Combat["kind"],
  moves: Stat[] = ["attack", "attack", "attack"],
) => {
  const c = battle(s, kind);
  moves.forEach((element) => round(c, element));
};
const count = (s: GameState, actor: number, n: number) => {
  const p = s.players[actor];
  p.inventory = [];
  for (let i = 0; i < n; i++) addItem(s, p, "herb");
};
const scores = (s: GameState, values: number[]) => {
  s.finalComparison = values;
  s.players.forEach((p, i) => {
    p.fp = values[i];
  });
};
const dominant = (s: GameState) => {
  s.players[0].stats.insight = 8;
};

const daily: Record<number, Cases> = {
  1: [
    (s) => fact(s, "research", { amount: 1 }),
    (s) => fact(s, "research", { amount: 0 }),
    (s) => fact(s, "research", { amount: 2 }),
  ],
  2: [
    (s) => {
      fact(s, "gather", { amount: 2 });
      fact(s, "brew");
    },
    (s) => {
      fact(s, "gather");
      fact(s, "research", { day: 2 });
    },
    (s) => {
      fact(s, "research", { amount: 0 });
      fact(s, "gather", { amount: 0 });
    },
  ],
  3: [
    (s) => fact(s, "brew"),
    (s) => fact(s, "acquirePotion"),
    (s) => {
      fact(s, "brew");
      fact(s, "brew");
    },
  ],
  4: [
    (s) => {
      fact(s, "research", { amount: 1, kind: "attack" });
      fact(s, "research", { amount: 1, kind: "defense" });
    },
    (s) => fact(s, "research", { amount: 1 }),
    (s) => fact(s, "research", { amount: 2 }),
  ],
  5: [
    (s) => fact(s, "acquirePotion", { kind: "flame" }),
    (s) => fact(s, "receive", { kind: "herb" }),
    (s) => {
      fact(s, "acquirePotion", { kind: "flame" });
      s.players[0].inventory = [];
    },
  ],
  6: [
    (s) => fact(s, "gather", { amount: 2 }),
    (s) => {
      fact(s, "gather", { amount: 1 });
      fact(s, "receive", { amount: 1 });
    },
    (s) => {
      fact(s, "gather", { amount: 0 });
      fact(s, "gather", { amount: 1 });
      fact(s, "gather", { amount: 1 });
    },
  ],
  7: [
    (s) => trade(s),
    (s) => {
      fact(s, "reserve");
      fact(s, "contribution");
      fact(s, "tradeRejected");
    },
    (s) => trade(s, 1, 0, 1),
  ],
  8: [(s) => trade(s), (s) => trade(s, 1, 0, 1), (s) => trade(s, 1, 1, 1)],
  9: [
    (s) => {
      trade(s);
      trade(s, 2);
    },
    (s) => {
      trade(s);
      trade(s);
    },
    (s) => {
      trade(s);
      trade(s, 2, 0, 1);
    },
  ],
  10: [
    (s) => trade(s),
    (s) => trade(s, 1, 1, 1),
    (s) => {
      trade(s);
      trade(s, 2, 0, 1);
    },
  ],
  11: [
    (s) => {
      fact(s, "gather");
      fact(s, "contribution");
    },
    (s) => {
      fact(s, "research");
      fact(s, "reserve");
    },
    (s) => {
      fact(s, "research", { amount: 0 });
      fact(s, "contribution");
    },
  ],
  12: [
    (s) => fact(s, "fp", { amount: 1, kind: "duel" }),
    (s) => fact(s, "fp", { amount: 1, kind: "ho" }),
    (s) => {
      fact(s, "fp", { amount: 1, kind: "event" });
      fact(s, "fp", { amount: -1, kind: "scout" });
    },
  ],
  13: [
    (s) => scout(s),
    (s) => fact(s, "scoutBlocked"),
    (s) => {
      s.players[1].fp = 0;
      scout(s);
    },
  ],
  14: [
    (s) => fact(s, "loot", { amount: 1, data: { initiated: true } }),
    (s) => fact(s, "loot", { amount: 1, data: { initiated: false } }),
    (s) => {
      s.day = 8;
      fact(s, "loot", { amount: 1, data: { initiated: true } });
    },
  ],
  15: [
    (s) => fact(s, "rest"),
    (s) => fact(s, "nightChoice", { kind: "rest" }),
    (s) => {
      s.day = 8;
      fact(s, "rest");
    },
  ],
  16: [
    (s) => battle(s, "secret"),
    (s) => battle(s, "secret", 0, [1, 0]),
    (s) => fact(s, "automaticBattle"),
    false,
  ],
  17: [
    (s) => fact(s, "curseHit", { target: 1 }),
    (s) => fact(s, "curseBlocked"),
    (s) => {
      s.day = 8;
      fact(s, "curseHit", { target: 1 });
    },
  ],
  18: [
    (s) => fact(s, "guard"),
    (s) => fact(s, "rest"),
    (s) => fact(s, "guard", { amount: 0 }),
  ],
  19: [
    (s) => battle(s, "public", 1, [1, 0]),
    (s) => battle(s, "mock"),
    (s) => battle(s, "public", null),
  ],
  20: [
    (s) => battle(s),
    (s) => battle(s, "public", null),
    (s) => battle(s, "public", 0, [1, 0]),
  ],
  21: [
    (s) => round(battle(s), "attack", 1, 2),
    (s) => round(battle(s), "attack", 1, 1),
    (s) => round(battle(s, "public", null), "attack", 1, 2),
  ],
  22: [
    (s) => fact(s, "command", { target: 1 }),
    (s) => battle(s, "secret"),
    (s) => {
      s.day = 8;
      fact(s, "loot", { amount: 1, data: { initiated: false } });
    },
  ],
  23: [
    (s) => {
      trade(s);
      battle(s);
    },
    (s) => {
      trade(s);
      battle(s, "mock");
    },
    (s) => {
      battle(s, "public", null);
      trade(s, 2, 0, 1);
    },
  ],
  24: [
    (s) => triple(s, "secret"),
    (s) => triple(s, "public", ["attack", "attack", "defense", "attack"]),
    (s) => triple(s, "mock"),
    false,
  ],
};
const long: Record<number, Cases> = {
  1: [
    (s) => scores(s, [7, 5, 0, 0]),
    (s) => scores(s, [7, 6, 0, 0]),
    (s) => {
      scores(s, [7, 5, 0, 0]);
      s.players[1].fp = 6;
    },
  ],
  2: [
    (s) => {
      trade(s);
      trade(s);
      battle(s);
    },
    (s) => {
      trade(s, 2);
      trade(s, 2);
      battle(s);
    },
    (s) => {
      battle(s);
      trade(s);
      trade(s, 1, 0, 1);
    },
  ],
  3: [
    (s) =>
      [1, 2, 3].forEach((target) => fact(s, "receive", { target, amount: 2 })),
    (s) =>
      [3, 2, 1].forEach((amount, i) =>
        fact(s, "receive", { target: i + 1, amount }),
      ),
    (s) => {
      [1, 2, 3].forEach((target) => fact(s, "receive", { target, amount: 2 }));
      s.players[0].inventory = [];
    },
  ],
  5: [
    (s) => {
      battle(s);
      battle(s, "secret");
    },
    (s) => {
      battle(s);
      battle(s, "secret", 0, [0, 2]);
    },
    (s) => {
      battle(s);
      fact(s, "automaticBattle");
    },
    false,
  ],
  6: [
    (s) => {
      fact(s, "contribution", { day: 1 });
      fact(s, "contribution", { day: 2 });
      fact(s, "contribution", { actor: 1, day: 1 });
    },
    (s) => {
      fact(s, "contribution");
      fact(s, "contribution", { actor: 1 });
    },
    (s) => fact(s, "contribution", { amount: 1 }),
  ],
  7: [
    (s) => {
      scout(s, 1, 1);
      scout(s, 1, 2);
      trade(s);
    },
    (s) => {
      scout(s, 2, 1);
      scout(s, 2, 2);
      trade(s);
    },
    (s) => {
      scout(s);
      scout(s);
      trade(s);
    },
    false,
  ],
  8: [
    (s) => fact(s, "givePotion", { target: 1, amount: 3 }),
    (s) => {
      fact(s, "givePotion", { amount: 2 });
      fact(s, "surrender");
    },
    (s) => {
      trade(s, 1, 3);
      fact(s, "givePotion", { target: 1, amount: 3, kind: "flame" });
    },
  ],
  9: [
    (s) => {
      count(s, 0, 5);
      count(s, 1, 4);
    },
    (s) => {
      count(s, 0, 4);
      count(s, 1, 4);
    },
    (s) => {
      count(s, 0, 4);
      count(s, 1, 4);
      s.players[0].inventory.push(s.players[1].inventory.pop()!);
    },
  ],
  10: [
    (s) =>
      [1, 2].forEach((target) =>
        fact(s, "commandExecuted", { target, data: { qualifies: true } }),
      ),
    (s) => {
      fact(s, "commandExecuted", { target: 1, data: { qualifies: true } });
      fact(s, "command", { target: 2 });
    },
    (s) => {
      fact(s, "commandExecuted", { target: 1, data: { qualifies: true } });
      fact(s, "commandExecuted", { target: 2, data: { qualifies: false } });
    },
    false,
  ],
  11: [
    (s) => {
      fact(s, "curseHit", { target: 1 });
      battle(s);
    },
    (s) => {
      fact(s, "curseBlocked", { target: 1 });
      battle(s);
    },
    (s) => {
      battle(s);
      fact(s, "curseHit", { target: 1, day: 8 });
    },
  ],
  12: [
    (s) => {
      trade(s);
      scout(s);
      trade(s, 2);
      scout(s, 2);
    },
    (s) => {
      trade(s);
      scout(s);
      scout(s, 2);
      trade(s, 2);
    },
    (s) => {
      trade(s);
      trade(s, 2);
      scout(s);
      scout(s, 2);
    },
  ],
  13: [
    (s) => battle(s, "public", 1, [1, 2]),
    (s) => battle(s, "mock", 1, [1, 2]),
    (s) => battle(s, "public", null, [1, 2]),
  ],
  16: [
    (s) => {
      battle(s, "public", 2, [1, 2]);
      scout(s);
    },
    (s) => {
      scout(s);
      battle(s, "public", 2, [1, 2]);
    },
    (s) => {
      battle(s);
      scout(s, 1, 1);
      scout(s, 1, 2);
      scout(s, 1, 3);
    },
  ],
  17: [
    (s) => {
      scores(s, [7, 6, 5, 9]);
      battle(s, "public", 3, [1, 3]);
      battle(s, "public", 3, [2, 3]);
    },
    (s) => scores(s, [7, 7, 5, 6]),
    (s) => scores(s, [9, 6, 5, 8]),
  ],
  18: [
    (s) => {
      scores(s, [8, 7, 6, 5]);
      fact(s, "give", { target: 1, amount: 3 });
    },
    (s) => {
      scores(s, [8, 7, 6, 5]);
      fact(s, "give", { target: 1, amount: 2 });
      fact(s, "surrender");
    },
    (s) => {
      scores(s, [8, 8, 6, 5]);
      fact(s, "give", { target: 1, amount: 3 });
    },
  ],
  19: [
    (s) => {
      battle(s);
      battle(s, "secret");
      scout(s);
    },
    (s) => {
      battle(s);
      battle(s, "secret");
      fact(s, "scoutBlocked");
    },
    (s) => {
      scout(s);
      battle(s);
      battle(s, "secret");
    },
  ],
  20: [
    (s) => {
      dominant(s);
      fact(s, "defensiveWin");
      fact(s, "defensiveWin");
    },
    (s) => {
      s.players.forEach(
        (p) => (p.stats = { attack: 3, defense: 3, insight: 3 }),
      );
      fact(s, "defensiveWin");
      fact(s, "defensiveWin");
    },
    (s) => {
      dominant(s);
      fact(s, "defensiveWin", { target: 1 });
      fact(s, "defensiveWin", { target: 1 });
    },
  ],
  21: [
    (s) => [1, 2, 3].forEach((day) => fact(s, "rest", { day })),
    (s) => [1, 1, 2].forEach((day) => fact(s, "rest", { day })),
    (s) => [1, 2, 8].forEach((day) => fact(s, "rest", { day })),
  ],
  22: [
    (s) => dominant(s),
    (s) =>
      s.players.forEach(
        (p) => (p.stats = { attack: 3, defense: 3, insight: 3 }),
      ),
    (s) => {
      s.players.forEach(
        (p) => (p.stats = { attack: 3, defense: 3, insight: 3 }),
      );
      fact(s, "research", { amount: 2 });
    },
    false,
  ],
  23: [
    (s) =>
      ["abundance", "flame", "invisibility"].forEach((kind) =>
        fact(s, "usePotion", { kind }),
      ),
    (s) => {
      fact(s, "publicPotion", { kind: "abundance" });
      fact(s, "usePotion", { kind: "invisibility" });
    },
    (s) =>
      ["flame", "flame", "invisibility"].forEach((kind) =>
        fact(s, "usePotion", { kind }),
      ),
    false,
  ],
  24: [
    (s) => {
      battle(s, "public", 1);
      battle(s, "secret", 2, [0, 2]);
    },
    (s) => {
      battle(s, "public", 1);
      battle(s, "secret", 1);
    },
    (s) => {
      battle(s, "public", 1);
      battle(s, "mock", 2, [0, 2]);
    },
    false,
  ],
  25: [
    (s) => [2, 3, 4, 5].forEach((n, i) => count(s, i, n)),
    (s) => [3, 4, 4, 4].forEach((n, i) => count(s, i, n)),
    (s) => [2, 2, 3, 4].forEach((n, i) => count(s, i, n)),
  ],
};
for (const [prefix, definitions, cases, evaluate] of [
  ["D", DAILY_GOALS, daily, dailyAchieved],
  ["L", LONG_GOALS, long, longAchieved],
] as const) {
  describe(`${prefix} の全判定`, () => {
    it("全IDを網羅する", () =>
      expect(Object.keys(cases).map(Number)).toEqual(
        definitions.map((d) => d.id).sort((a, b) => a - b),
      ));
    for (const { id } of definitions) {
      const [yes, no, edge, edgeExpected = true] = cases[id];
      const goal: Goal = {
        id,
        targets: id === 13 || id === 17 ? [1, 2] : [1],
        achieved: false,
      };
      it.each([
        ["成立", yes, true],
        ["不成立", no, false],
        ["境界", edge, edgeExpected],
      ] as const)(
        `${prefix}${String(id).padStart(2, "0")} %s`,
        (_label, prepare, expected) => {
          const s = game();
          if (prefix === "L") s.day = 8;
          prepare(s);
          expect(evaluate(s, s.players[0], goal)).toBe(expected);
        },
      );
    }
  });
}

function donate(s: GameState, actor: number, ...kinds: string[]) {
  const p = s.players[actor];
  const ids = kinds.map((kind) => addItem(s, p, kind).id);
  reserve(s, p, ids, {});
  return ids;
}
const sand = (n: number) => Array<string>(n).fill("sand");
function points(s: GameState, actor: number, amount: number) {
  reserve(s, s.players[actor], [], {
    attack: Math.min(2, amount),
    defense: Math.min(2, Math.max(0, amount - 2)),
    insight: Math.max(0, amount - 4),
  });
}
const mock = (s: GameState) => {
  s.event.mock = [1, 2];
};
const events: Record<number, Cases> = {
  1: [
    (s) => {
      donate(s, 0, ...sand(4));
    },
    (s) => {
      donate(s, 0, ...sand(3));
    },
    (s) => {
      donate(s, 0, ...sand(4));
      donate(s, 1, "sand");
    },
  ],
  2: [
    (s) => {
      donate(s, 0, "herb", "herb", "sand", "sand");
    },
    (s) => {
      donate(s, 0, "herb", "herb", "sand");
    },
    (s) => {
      donate(s, 0, "herb", "herb", "herb", "herb");
    },
  ],
  3: [
    (s) => {
      fact(s, "gather");
      fact(s, "gather");
      fact(s, "research", { actor: 1 });
      fact(s, "gather", { actor: 2 });
    },
    (s) => {
      fact(s, "gather");
      fact(s, "gather");
      fact(s, "research");
      fact(s, "researchCancelled");
    },
    (s) => {
      for (let i = 0; i < 4; i++) fact(s, "gather", { amount: 0 });
      fact(s, "research", { actor: 1, amount: 0 });
    },
  ],
  4: [
    mock,
    (s) => {
      battle(s, "public");
    },
    (s) => {
      battle(s, "mock", null, [1, 2]);
      mock(s);
    },
  ],
  5: [
    (s) => {
      donate(s, 0, "herb", "water", ...sand(4));
    },
    (s) => {
      donate(s, 0, "herb", ...sand(5));
    },
    (s) => {
      donate(s, 0, "herb", ...sand(5));
      donate(s, 1, "water");
    },
  ],
  6: [
    (s) => points(s, 0, 4),
    (s) => {
      points(s, 0, 3);
      fact(s, "publicPotion");
    },
    (s) => {
      points(s, 0, 4);
      points(s, 1, 1);
    },
  ],
  7: [
    (s) => {
      donate(s, 0, "flame", "ice", "invisibility", "might");
    },
    (s) => {
      donate(s, 0, "flame", "ice", "invisibility");
    },
    (s) => {
      donate(s, 0, "flame", "flame", "flame", "flame");
      donate(s, 1, "ice");
    },
  ],
  8: [
    (s) => {
      donate(s, 0, ...sand(3));
      donate(s, 1, "herb", "herb");
      donate(s, 2, "herb");
    },
    (s) => {
      donate(s, 0, ...Array<string>(6).fill("herb"));
    },
    (s) => {
      donate(s, 0, ...sand(2));
      donate(s, 1, "herb", "herb");
      donate(s, 2, "herb", "herb");
      donate(s, 3, ...sand(3));
    },
  ],
  9: [
    (s) => {
      for (let i = 0; i < 4; i++)
        fact(s, "research", { actor: i % 2, amount: 1 });
    },
    (s) => {
      for (let i = 0; i < 3; i++) fact(s, "research");
      fact(s, "gather");
    },
    (s) => {
      for (let i = 0; i < 4; i++) fact(s, "research", { amount: 0 });
      fact(s, "research", { actor: 2, amount: 0 });
    },
  ],
  10: [
    (s) => {
      donate(s, 0, ...sand(8));
      mock(s);
    },
    (s) => {
      donate(s, 0, ...sand(7));
      mock(s);
    },
    (s) => {
      mock(s);
      donate(s, 0, ...sand(8));
      donate(s, 2, "sand");
    },
  ],
  11: [
    (s) => {
      donate(s, 0, "dew", "dew", "dew", "dew");
      points(s, 1, 4);
    },
    (s) => {
      donate(s, 0, "dew", "dew", "dew");
      points(s, 1, 4);
    },
    (s) => {
      donate(s, 0, "dew", "dew", "dew", "dew");
      points(s, 1, 4);
      points(s, 2, 1);
    },
  ],
  12: [
    (s) => {
      donate(s, 0, ...sand(8));
    },
    (s) => {
      donate(s, 0, ...sand(7));
      points(s, 1, 4);
    },
    (s) => {
      donate(s, 0, ...sand(8));
      withdraw(s, s.players[0]);
      points(s, 1, 5);
      donate(s, 0, ...sand(8));
    },
  ],
};
const successFP: Record<number, number[]> = {
  1: [1, 0, 0, 0],
  2: [1, 0, 0, 0],
  3: [1, 1, 1, 0],
  4: [0, 0, 0, 0],
  5: [1, 0, 0, 0],
  6: [2, 0, 0, 0],
  7: [1, 0, 0, 0],
  8: [1, 0, 0, 0],
  9: [1, 1, 0, 0],
  10: [1, 0, 0, 0],
  11: [2, 2, 0, 0],
  12: [2, 0, 0, 0],
};
const edgeFP: Record<number, number[]> = {
  ...successFP,
  3: [1, 1, 0, 0],
  5: [1, 1, 0, 0],
  8: [1, 1, 1, 0],
  9: [1, 0, 1, 0],
  12: [0, 2, 0, 0],
};
describe("E の全判定", () => {
  it("全IDを網羅する", () =>
    expect(Object.keys(events).map(Number)).toEqual(EVENTS.map((e) => e.id)));
  for (const { id } of EVENTS) {
    const [yes, no, edge] = events[id];
    it.each([
      ["成立", yes, true],
      ["不成立", no, false],
      ["境界", edge, true],
    ] as const)(
      `E${String(id).padStart(2, "0")} %s`,
      (label, prepare, expected) => {
        const s = game();
        s.event.id = id;
        s.event.specified = "dew";
        s.players.forEach(
          (p) => (p.stats = { attack: 3, defense: 3, insight: 3 }),
        );
        prepare(s);
        const before = s.players.map((p) => ({
          stats: { ...p.stats },
          ids: p.inventory.map((i) => i.id),
        }));
        resolveEvent(s);
        expect(s.event.success).toBe(expected);
        expect(s.failed).toBe(expected ? 0 : 1);
        expect(s.event.reservations).toEqual([]);
        expect(
          s.players.flatMap((p) => p.inventory).some((i) => i.lock === "event"),
        ).toBe(false);
        expect(s.players.map((p) => p.fp)).toEqual(
          expected ? (label === "境界" ? edgeFP : successFP)[id] : [0, 0, 0, 0],
        );
        const contributors = s.logs
          .filter((l) => l.type === "contribution")
          .map((l) => l.actor);
        if (!expected) {
          expect(contributors).toEqual([]);
          expect(
            s.players.map((p) => ({
              stats: p.stats,
              ids: p.inventory.map((i) => i.id),
            })),
          ).toEqual(before);
        } else {
          const contributorsExpected = s.players
            .filter((p) => p.fp > 0)
            .map((p) => p.id);
          if ([4, 8, 10].includes(id)) {
            for (const p of id === 8 ? [0, 1, 2] : [1, 2])
              if (!contributorsExpected.includes(p))
                contributorsExpected.push(p);
          }
          expect(contributors).toEqual(contributorsExpected.sort());
          if ([4, 10].includes(id))
            for (const actor of [1, 2])
              expect(
                s.players[actor].inventory.filter(
                  (i) => !before[actor].ids.includes(i.id),
                ),
              ).toHaveLength(2);
          if (label === "境界" && [1, 5, 7, 8, 10].includes(id)) {
            const surplus = id === 5 ? 0 : id === 8 ? 3 : id === 10 ? 2 : 1;
            expect(
              s.players[surplus].inventory.some(
                (i) => i.id === before[surplus].ids.at(-1),
              ),
            ).toBe(true);
          }
          if (label === "境界" && id === 12) {
            expect(s.event.route).toBe("stats");
            expect(s.players[0].inventory.map((i) => i.id)).toEqual(
              before[0].ids,
            );
          }
        }
        expect(() => resolveEvent(s)).toThrow("判定済み");
      },
    );
  }
});

function finalDay() {
  const s = game();
  s.day = 8;
  s.phase = "ho";
  s.event.resolved = true;
  s.event.acknowledged = true;
  s.players.forEach((p, i) => {
    p.fp = [7, 5, 7, 10][i];
    p.dailyGoal = { id: 1, targets: [], achieved: false };
    p.longGoal = { id: 1, targets: [3], achieved: false };
  });
  s.players[0].longGoal.targets = [1];
  s.players[2].longGoal = { id: 21, targets: [], achieved: false };
  for (const day of [1, 2, 8]) fact(s, "rest", { actor: 2, day });
  return s;
}
describe("第8日の終了順", () => {
  it("日次報酬前のFPで卒業し、報酬後のFPで首席を決める", () => {
    const s = finalDay();
    fact(s, "research", { actor: 1, amount: 1 });
    fact(s, "research", { actor: 2, amount: 1 });
    const result = dispatch(s, { type: "advance" });
    expect(result.finalComparison).toEqual([7, 5, 7, 10]);
    expect(result.players.map((p) => p.fp)).toEqual([7, 6, 8, 10]);
    expect(result.result?.graduates).toEqual([0, 2]);
    expect(result.result?.chiefs).toEqual([2]);
    expect(result.result?.ranking.map((r) => r.rank)).toEqual([
      2,
      null,
      1,
      null,
    ]);
    expect(
      result.players.every(
        (p) => p.dailyHistory.filter((h) => h.day === 8).length === 1,
      ),
    ).toBe(true);
  });

  it("FP同点では日次達成数を比較し、両方同じなら共同首席", () => {
    const s = finalDay();
    s.players[2].dailyHistory.push({ day: 1, id: 15, achieved: true });
    const ranked = dispatch(s, { type: "advance" });
    expect(ranked.result?.chiefs).toEqual([2]);
    expect(ranked.result?.ranking.map((r) => r.rank)).toEqual([
      2,
      null,
      1,
      null,
    ]);
    s.players[0].dailyHistory.push({ day: 1, id: 15, achieved: true });
    const tied = dispatch(s, { type: "advance" });
    expect(tied.result?.chiefs).toEqual([0, 2]);
    expect(tied.result?.ranking.map((r) => r.rank)).toEqual([1, null, 1, null]);
  });

  it("卒業者なしでも研究所は存続し、首席なし", () => {
    const s = finalDay();
    s.players[0].longGoal.targets = [3];
    s.players[2].longGoal.id = 22;
    s.players.forEach((p) => (p.stats = { attack: 3, defense: 3, insight: 3 }));
    const ended = dispatch(s, { type: "advance" });
    expect(ended.result).toMatchObject({
      reason: "completed",
      graduates: [],
      chiefs: [],
    });
  });

  it("第7日まで長期HOは確定しない", () => {
    const s = finalDay();
    s.day = 7;
    const dawn = dispatch(s, { type: "advance" });
    expect(dawn.phase).toBe("dawn");
    expect(dawn.finalComparison).toBeUndefined();
    expect(dawn.players[0].longGoal.achieved).toBe(false);
  });
});
