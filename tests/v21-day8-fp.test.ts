import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createGame, dispatch } from "../src/domain/reducer";
import { fp, log } from "../src/domain/core";
import {
  beginDay8Fp,
  day8FpBreakdown,
  finishDay8Fp,
} from "../src/domain/day8Fp";
import { finishNight } from "../src/domain/night";
import { resolveEvent } from "../src/domain/events";
import { serialize, deserialize } from "../src/domain/persistence";
import { simulationAction } from "../src/domain/simulation";
import { useGameStore } from "../src/stores/game";
import { day8Fixture, day8Setup } from "./fixtures/v21Day8";
import baseline from "./fixtures/v21-phase3-fp-baseline.json" with { type: "json" };
import type { GameState, Setup } from "../src/domain/types";

afterEach(() => vi.unstubAllGlobals());
function unit(version = "browser-2.1", day = 8) {
  const s = createGame(day8Setup, version);
  s.day = day;
  s.phase = "ho";
  for (const p of s.players) {
    p.fp = 5;
    p.dailyGoal = { id: 1, targets: [], achieved: false };
    p.longGoal = { id: 1, targets: [(p.id + 1) % 4], achieved: false };
  }
  beginDay8Fp(s);
  return s;
}
function end(s: GameState) {
  return dispatch(s, { type: "advance", pauseAtDawn: true });
}
function consistent(s: GameState) {
  const rows = day8FpBreakdown(s)!.players;
  expect(rows.map((p) => p.player)).toEqual([0, 1, 2, 3]);
  for (const row of rows) {
    expect(row.end - row.start).toBe(
      row.entries.reduce((n, e) => n + e.amount, 0),
    );
    expect(row.end).toBe(s.players[row.player].fp);
    let current = row.start;
    for (const e of row.entries) {
      current += e.amount;
      expect(e.fpAfter).toBe(current);
      expect(e.day).toBe(8);
      expect(e.player).toBe(row.player);
    }
  }
}

it("records actual signed/clamped deltas in order and does not record zero attempts", () => {
  const s = unit();
  const rng = [s.rng, s.draws];
  fp(s, s.players[0], 2, "duel", { relatedPlayers: [1] });
  fp(s, s.players[0], -10, "scout", { relatedPlayers: [2, 3] });
  fp(s, s.players[0], -1, "scout");
  fp(s, s.players[1], 0, "event");
  expect(
    s.day8Fp!.entries.map((e) => [e.order, e.amount, e.fpAfter, e.reason]),
  ).toEqual([
    [1, 2, 7, "duel"],
    [2, -7, 0, "scout"],
  ]);
  expect([s.rng, s.draws]).toEqual(rng);
  const out = end(s);
  consistent(out);
  expect(day8FpBreakdown(out)!.players[1]).toMatchObject({
    start: 5,
    end: 5,
    change: 0,
    entries: [],
  });
});

it("a zero net total retains real positive and negative entries", () => {
  const s = unit();
  fp(s, s.players[0], 1, "event", { eventId: 3 });
  fp(s, s.players[0], -1, "scout", { relatedPlayers: [2] });
  const out = end(s);
  consistent(out);
  expect(day8FpBreakdown(out)!.players[0]).toMatchObject({
    start: 5,
    end: 5,
    change: 0,
  });
  expect(day8FpBreakdown(out)!.players[0].entries.map((e) => e.amount)).toEqual(
    [1, -1],
  );
});

it("distinguishes missing records from a confirmed day with no changes, without reading logs", () => {
  const s = unit();
  expect(day8FpBreakdown(s)).toBeUndefined();
  const out = end(s);
  const raw = serialize(out);
  expect(
    day8FpBreakdown(out)!.players.every(
      (p) => p.entries.length === 0 && p.change === 0,
    ),
  ).toBe(true);
  const missing = structuredClone(out);
  delete missing.day8Fp;
  expect(missing.logs.length).toBeGreaterThan(0);
  expect(day8FpBreakdown(missing)).toBeUndefined();
  expect(serialize(out)).toBe(raw);
});

it.each([1, 7])("does not add a new record on day %i", (day) => {
  const s = unit("browser-2.1", day);
  fp(s, s.players[0], 1, "ho");
  expect(s.day8Fp).toBeUndefined();
});

it.each([
  "browser-2.0",
  "browser-2.0.1",
  "browser-2.0.2",
  "browser-2.0.3",
  "browser-2.0.4",
])(
  "%s never gains a record and missing breakdown is valid",
  (version) => {
    let s = createGame(day8Setup, version);
    while (!s.result) s = dispatch(s, simulationAction(s));
    expect(s.day8Fp).toBeUndefined();
    expect(day8FpBreakdown(s)).toBeUndefined();
    expect(deserialize(serialize(s))).toEqual(s);
  },
  20000,
);

it("daily success records one FP each, failure none, and long HO adds nothing", () => {
  const s = unit();
  log(s, "research", "research", { actor: 0, amount: 1 });
  log(s, "research", "research", { actor: 2, amount: 1 });
  const out = end(s);
  consistent(out);
  expect(
    out.day8Fp!.entries.map((e) => [e.player, e.reason, e.amount]),
  ).toEqual([
    [0, "ho", 1],
    [2, "ho", 1],
  ]);
  expect(out.players.map((p) => p.fp)).toEqual([6, 5, 6, 5]);
  expect(() => end(out)).toThrow();
  const raw = serialize(out);
  day8FpBreakdown(out);
  day8FpBreakdown(out);
  finishDay8Fp(out);
  beginDay8Fp(out);
  expect(serialize(out)).toBe(raw);
});

it.each([0, 1])(
  "public duel records the actual winner %i, opponent and day-8 two FP exactly once",
  (winner) => {
    let s = unit();
    s.phase = "public";
    s = dispatch(s, { type: "duel", player: 0, target: 1 });
    s = dispatch(s, { type: "loadout", player: 0, items: [] });
    s.combat!.hp = winner === 0 ? [12, 1] : [1, 12];
    s = dispatch(s, { type: "elementRound", player: 0, element: "defense" });
    expect(s.day8Fp!.entries).toEqual([
      {
        order: 1,
        day: 8,
        player: winner,
        amount: 2,
        reason: "duel",
        fpAfter: 7,
        relatedPlayers: [1 - winner],
      },
    ]);
    s = dispatch(s, { type: "combatAck", player: 0 });
    expect(s.day8Fp!.entries).toHaveLength(1);
  },
);

it("one common event records all four actual rewards with event ID", () => {
  const s = unit();
  s.event = {
    id: 3,
    specified: "water",
    reservations: [],
    mock: [],
    resolved: false,
  };
  for (const p of s.players)
    log(s, "gather", "gather", { actor: p.id, amount: 2 });
  resolveEvent(s);
  expect(s.event.success).toBe(true);
  expect(
    s.day8Fp!.entries.map((e) => [e.player, e.amount, e.reason, e.eventId]),
  ).toEqual([
    [0, 1, "event", 3],
    [1, 1, "event", 3],
    [2, 1, "event", 3],
    [3, 1, "event", 3],
  ]);
  s.event.acknowledged = true;
  const out = end(s);
  consistent(out);
});

it("failed common event adds no fictitious reward", () => {
  const s = unit();
  s.event = {
    id: 1,
    specified: "water",
    reservations: [],
    mock: [],
    resolved: false,
  };
  resolveEvent(s);
  expect(s.event.success).toBe(false);
  expect(s.day8Fp!.entries).toEqual([]);
});

it("successful scout combats record aggregate deduction and only actual responsible players", () => {
  const s = unit();
  s.phase = "results";
  for (const p of s.players) p.night = { kind: "guard", recipes: [] };
  for (const id of [0, 1, 3])
    s.players[id].night = { kind: "scout", target: 2, recipes: [] };
  s.nightWork = {
    battle: 0,
    reward: 0,
    valid: [0, 1, 3],
    battles: [0, 1, 3].map((id) => ({
      participants: [id, 2],
      raids: [],
      scout: id,
      winner: id,
    })),
  };
  const before = s.players[2].fp;
  finishNight(s);
  expect(s.day8Fp!.entries).toEqual([
    {
      order: 1,
      day: 8,
      player: 2,
      amount: -3,
      reason: "scout",
      fpAfter: before - 3,
      relatedPlayers: s.publicTurn.order.filter((id) => id !== 2),
    },
  ]);
  consistent(end(s));
});

it("blocked scouts and secret raid victories do not invent FP", () => {
  const s = unit();
  s.phase = "results";
  for (const p of s.players) p.night = { kind: "guard", recipes: [] };
  s.players[0].night = { kind: "scout", target: 2, recipes: [] };
  s.nightWork = {
    battle: 0,
    reward: 0,
    valid: [0],
    battles: [
      { participants: [0, 2], raids: [], scout: 0, winner: 2 },
      { participants: [1, 3], raids: [1], winner: 1 },
    ],
  };
  finishNight(s);
  expect(s.day8Fp!.entries).toEqual([]);
});

it("future shared view only exposes allowed FP fields, after ending, and returns independent copies", () => {
  const s = unit();
  fp(s, s.players[0], -1, "scout", { relatedPlayers: [1] });
  log(s, "secret", "DO NOT LEAK", {
    actor: 1,
    audience: [1],
    data: { rounds: ["secret"] },
  });
  expect(day8FpBreakdown(s)).toBeUndefined();
  const out = end(s);
  const raw = serialize(out);
  const view = day8FpBreakdown(out)!;
  expect(Object.keys(view)).toEqual(["day", "players"]);
  expect(Object.keys(view.players[0])).toEqual([
    "player",
    "start",
    "end",
    "change",
    "entries",
  ]);
  expect(Object.keys(view.players[0].entries[0])).toEqual([
    "order",
    "day",
    "player",
    "amount",
    "reason",
    "fpAfter",
    "relatedPlayers",
  ]);
  expect(JSON.stringify(view)).not.toMatch(
    /DO NOT LEAK|rounds|longGoal|dailyGoal|inventory|magic|audience/,
  );
  expect(out.logs.filter((l) => l.type === "fp")[0].audience).toEqual([0]);
  view.players[0].entries[0].relatedPlayers!.push(3);
  view.players[0].end = 999;
  expect(serialize(out)).toBe(raw);
});

it("collapse retains only confirmed changes and stops before any HO reward", () => {
  const s = unit();
  s.phase = "public";
  fp(s, s.players[0], 2, "duel", { relatedPlayers: [1] });
  s.failed = 2;
  s.publicTurn.round = 4;
  s.event = {
    id: 1,
    specified: "water",
    reservations: [],
    mock: [],
    resolved: false,
  };
  for (const p of s.players) p.inventory = [];
  log(s, "research", "would satisfy daily HO", { actor: 0, amount: 1 });
  const out = dispatch(s, { type: "advance" });
  expect(out.result!.reason).toBe("collapse");
  consistent(out);
  expect(out.day8Fp!.entries).toEqual(s.day8Fp!.entries);
  expect(out.players[0].fp).toBe(7);
  expect(out.players.every((p) => p.dailyHistory.length === 0)).toBe(true);
  expect(() => end(out)).toThrow();
});

it("legal day-8 beginning, confirmation, strict saves and duplicate rejection retain identical records", () => {
  const { before, after } = day8Fixture();
  expect(before.day8Fp).toBeDefined();
  expect(before.day8Fp!.final).toBeUndefined();
  expect(deserialize(serialize(before))).toEqual(before);
  expect(deserialize(serialize(after))).toEqual(after);
  consistent(after);
  expect(end(deserialize(serialize(before)))).toEqual(after);
  expect(() => end(after)).toThrow();
  const orders = after.day8Fp!.entries.map((e) => e.order);
  expect(orders).toEqual(orders.map((_, i) => i + 1));
}, 20000);

it("storage failure retries the same finalized record without RNG, FP or history recomputation", () => {
  const { before, after } = day8Fixture();
  const key = "majoken-save-rules-2.1";
  const values = new Map([[key, serialize(before)]]);
  let fail = true;
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (fail) throw Error("quota");
      values.set(k, v);
    },
  });
  setActivePinia(createPinia());
  const store = useGameStore();
  store.load();
  store.act({ type: "advance", pauseAtDawn: true });
  expect(store.pending).toEqual(after);
  expect(values.get(key)).toBe(serialize(before));
  store.act({ type: "advance" });
  expect(store.pending).toEqual(after);
  fail = false;
  store.save();
  store.load();
  store.save();
  expect(values.get(key)).toBe(serialize(after));
  expect(store.state).toEqual(after);
}, 20000);

it("pre-phase4 development day-8 save incompatibility never deletes or overwrites its bytes", () => {
  const { after } = day8Fixture();
  delete after.day8Fp;
  expect(day8FpBreakdown(after)).toBeUndefined();
  const raw = serialize(after),
    write = vi.fn();
  vi.stubGlobal("localStorage", { getItem: () => raw, setItem: write });
  setActivePinia(createPinia());
  const store = useGameStore();
  store.load();
  expect(store.error).toContain("操作ログが一致しません");
  expect(write).not.toHaveBeenCalled();
}, 20000);

for (const record of baseline.records)
  it(`preserves every phase-3 state/RNG/FP/HO/result excluding new record: ${record.setup.seed}`, () => {
    let s = createGame(record.setup as Setup, "browser-2.1");
    const chain = createHash("sha256");
    const append = () => {
      const copy = structuredClone(s);
      delete copy.day8Fp;
      chain.update(serialize(copy));
    };
    append();
    let captured = false;
    while (!s.result) {
      const previous = s;
      s = dispatch(s, simulationAction(s));
      if (previous.day === 7 && s.day === 8) {
        captured = true;
        expect(s.day8Fp!.start).toEqual(
          previous.players.map((p) => ({
            player: p.id,
            // One advance may both pay day-7 HO and enter day 8.
            fp:
              p.fp +
              s.logs
                .slice(previous.logs.length)
                .filter(
                  (l) => l.type === "fp" && l.day === 7 && l.actor === p.id,
                )
                .reduce((total, l) => total + l.amount!, 0),
          })),
        );
      }
      append();
    }
    expect(s.actions.length).toBe(record.steps);
    expect(chain.digest("hex")).toBe(record.chainHash);
    expect([s.rng, s.draws]).toEqual([record.rng, record.draws]);
    expect(s.players.map((p) => p.fp)).toEqual(record.fp);
    expect(s.players.map((p) => p.longGoal.achieved)).toEqual(record.long);
    expect(s.result).toEqual(record.result);
    expect(captured).toBe(true);
    consistent(s);
    expect(deserialize(serialize(s))).toEqual(s);
  }, 20000);
