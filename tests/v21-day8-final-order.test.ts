import { afterEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createGame, dispatch } from "../src/domain/reducer";
import { dailyAchieved, longAchieved } from "../src/domain/ho";
import { log } from "../src/domain/core";
import { deserialize, serialize } from "../src/domain/persistence";
import { ruleGuide } from "../src/ui/ruleGuide";
import { useGameStore } from "../src/stores/game";
import { day8Fixture, day8Setup } from "./fixtures/v21Day8";

// Synthetic boundary states test rules only; replay tests below use legal actions.
function boundary(version = "browser-2.1") {
  const s = createGame(day8Setup, version);
  s.day = 8;
  s.phase = "ho";
  for (const p of s.players) {
    p.fp = 10;
    p.dailyGoal = { id: 1, targets: [], achieved: false };
    p.longGoal = { id: 1, targets: [(p.id + 1) % 4], achieved: false };
    p.dailyHistory = [];
  }
  return s;
}
function reward(s: ReturnType<typeof boundary>, id: number) {
  log(s, "research", "境界テスト", { actor: id, amount: 1 });
}
function finish(s: ReturnType<typeof boundary>) {
  return dispatch(s, { type: "advance", pauseAtDawn: true });
}
afterEach(() => vi.unstubAllGlobals());

it("L01 changes from failure to success only after the day-8 reward", () => {
  const s = boundary();
  s.players[0].fp = 11;
  reward(s, 0);
  expect(longAchieved(s, s.players[0])).toBe(false);
  const out = finish(s);
  expect(out.finalComparison).toEqual([12, 10, 10, 10]);
  expect(out.players[0].longGoal.achieved).toBe(true);
  expect(out.result!.chiefs).toEqual([0]);
  expect(out.result!.ranking[1]).toMatchObject({
    fp: 10,
    rank: null,
    graduated: false,
  });
  expect(out.players.map((p) => p.fp)).toEqual([12, 10, 10, 10]);
  expect([out.rng, out.draws]).toEqual([s.rng, s.draws]);
});

it("all rewards precede every L01 comparison, including another player's reward", () => {
  const s = boundary();
  s.players[0].fp = 11;
  reward(s, 0);
  reward(s, 1);
  const out = finish(s);
  expect(out.players[0].longGoal.achieved).toBe(false);
  expect(out.finalComparison).toEqual([12, 11, 10, 10]);
  expect(out.players.map((p) => p.dailyHistory.length)).toEqual([1, 1, 1, 1]);
  expect(out.players.map((p) => p.dailyGoal.achieved)).toEqual(
    s.players.map((p) => dailyAchieved(s, p)),
  );
  expect(out.result!.chiefs).toEqual([]);
});

it("L17 strict maximum includes non-graduates and their final daily rewards", () => {
  const s = boundary();
  s.players[0].longGoal = { id: 17, targets: [1, 2], achieved: false };
  reward(s, 0);
  expect(longAchieved(s, s.players[0])).toBe(false);
  expect(finish(s).players[0].longGoal.achieved).toBe(true);
  reward(s, 1);
  expect(finish(s).players[0].longGoal.achieved).toBe(false);
});

it("L18 keeps transfer condition and counts the post-reward tied maximum", () => {
  const s = boundary();
  s.players[0].fp = 9;
  s.players[0].longGoal = { id: 18, targets: [1], achieved: false };
  reward(s, 0);
  expect(finish(s).players[0].longGoal.achieved).toBe(false);
  log(s, "give", "譲渡", { actor: 0, target: 1, amount: 3 });
  expect(longAchieved(s, s.players[0])).toBe(false);
  expect(finish(s).players[0].longGoal.achieved).toBe(true);
});

it("daily reward changes final rank among graduates, without awarding long-goal FP", () => {
  const s = boundary();
  for (const p of s.players) {
    p.longGoal = { id: 9, targets: [3], achieved: false };
    p.inventory = [];
  }
  s.players[0].inventory = [{ id: 900, kind: "herb" }];
  s.players[1].inventory = [{ id: 901, kind: "herb" }];
  reward(s, 1);
  const out = finish(s);
  expect(out.result!.graduates).toEqual([0, 1]);
  expect(out.result!.chiefs).toEqual([1]);
  expect(out.result!.ranking.map((p) => p.rank)).toEqual([2, 1, null, null]);
  expect(out.players.map((p) => p.fp)).toEqual([10, 11, 10, 10]);
});

it("ties compare daily success counts, then award every shared first place", () => {
  const s = boundary();
  for (const p of s.players)
    p.longGoal = { id: 18, targets: [(p.id + 1) % 4], achieved: false };
  for (const p of s.players)
    log(s, "give", "譲渡", {
      actor: p.id,
      target: p.longGoal.targets[0],
      amount: 3,
    });
  s.players[0].dailyHistory = [{ day: 1, id: 1, achieved: true }];
  let out = finish(s);
  expect(out.result!.chiefs).toEqual([0]);
  expect(out.result!.ranking.map((p) => p.rank)).toEqual([1, 2, 2, 2]);
  s.players[1].dailyHistory = [{ day: 1, id: 1, achieved: true }];
  out = finish(s);
  expect(out.result!.chiefs).toEqual([0, 1]);
  expect(out.result!.ranking.map((p) => p.rank)).toEqual([1, 1, 3, 3]);
  expect(out.players.map((p) => p.fp)).toEqual([10, 10, 10, 10]);
});

it("judgment order does not change the final snapshot or per-player achievements", () => {
  const s = boundary();
  for (const p of s.players)
    p.longGoal = { id: 17, targets: [(p.id + 1) % 4], achieved: false };
  reward(s, 0);
  const reversed = structuredClone(s);
  reversed.players.reverse();
  // Rank output uses canonical seats; compare the independent HO evaluation by ID.
  const a = finish(s),
    b = finish(reversed);
  expect(
    Object.fromEntries(
      b.players.map((p) => [p.id, [p.fp, p.longGoal.achieved]]),
    ),
  ).toEqual(
    Object.fromEntries(
      a.players.map((p) => [p.id, [p.fp, p.longGoal.achieved]]),
    ),
  );
});

it.each([
  "browser-2.0",
  "browser-2.0.1",
  "browser-2.0.2",
  "browser-2.0.3",
  "browser-2.0.4",
])("%s retains pre-reward comparison and old guide", (version) => {
  const s = boundary(version);
  s.players[0].fp = 11;
  reward(s, 0);
  const out = finish(s);
  expect(out.finalComparison).toEqual([11, 10, 10, 10]);
  expect(out.players[0].longGoal.achieved).toBe(false);
  expect(JSON.stringify(ruleGuide(version))).toContain("課題報酬を足す前");
});

it("collapse stops before night and any new HO judgment, with FP and ranks preserved", () => {
  const s = boundary();
  s.phase = "public";
  s.failed = 2;
  s.publicTurn.round = 4;
  s.publicTurn.index = 3;
  s.publicTurn.acted = true;
  s.event.resolved = false;
  s.event.reservations = [];
  s.event.mock = [];
  for (const p of s.players) {
    p.inventory = [];
    p.ap = 0;
  }
  s.players[0].longGoal = { id: 18, targets: [1], achieved: false };
  log(s, "give", "譲渡", { actor: 0, target: 1, amount: 3 });
  expect(longAchieved(s, s.players[0])).toBe(true);
  const fp = s.players.map((p) => p.fp),
    histories = s.players.map((p) => p.dailyHistory);
  const out = finish(s);
  expect(out.result!.reason).toBe("collapse");
  expect(out.phase).toBe("ended");
  expect(out.players.map((p) => p.fp)).toEqual(fp);
  expect(out.players.map((p) => p.dailyHistory)).toEqual(histories);
  expect(out.result!.ranking.every((p) => p.rank === null)).toBe(true);
  expect(out.result!.graduates).toEqual([]);
  expect(out.players[0].longGoal.achieved).toBe(false);
  expect(out.finalComparison).toBeUndefined();
  expect(
    out.logs.filter((l) => l.type === "dailyHO" || l.type === "nightResult"),
  ).toEqual([]);
  expect(() => finish(out)).toThrow();
});

it("legal day-8 saves replay strictly before/after judgment, and duplicate confirmation cannot pay twice", () => {
  const { before, after } = day8Fixture();
  expect(deserialize(serialize(before))).toEqual(before);
  expect(deserialize(serialize(after))).toEqual(after);
  expect(finish(deserialize(serialize(before)))).toEqual(after);
  expect(() => finish(after)).toThrow();
  expect(
    after.players.map((p) => p.dailyHistory.filter((h) => h.day === 8).length),
  ).toEqual([1, 1, 1, 1]);
  expect(after.finalComparison).toEqual(after.players.map((p) => p.fp));
}, 20000);

it("failed final save retains exactly the pending result; retry and reload never recalculate", () => {
  const { before, after } = day8Fixture();
  const key = "majoken-save-rules-2.1",
    values = new Map([[key, serialize(before)]]);
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
  expect(store.state).toEqual(before);
  expect(store.pending).toEqual(after);
  expect(values.get(key)).toBe(serialize(before));
  store.act({ type: "advance" });
  expect(store.pending).toEqual(after);
  fail = false;
  store.save();
  expect(store.state).toEqual(after);
  store.load();
  store.save();
  expect(values.get(key)).toBe(serialize(after));
  expect([store.state!.rng, store.state!.draws]).toEqual([
    after.rng,
    after.draws,
  ]);
}, 20000);

it("v2.1 guide explicitly uses all daily rewards before final comparison", () => {
  expect(JSON.stringify(ruleGuide("browser-2.1"))).toContain(
    "日次HO報酬を全員に反映した後の同一状態のFP",
  );
});

it("rejects a pre-phase3 completed v2.1 snapshot without changing the stored data or current game", () => {
  const { before, after } = day8Fixture();
  const old = structuredClone(after);
  old.finalComparison = before.players.map((p) => p.fp);
  expect(old.finalComparison).not.toEqual(after.finalComparison);
  const raw = serialize(old),
    key = "majoken-save-rules-2.1";
  const values = new Map([[key, raw]]),
    write = vi.fn();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: write,
  });
  setActivePinia(createPinia());
  const store = useGameStore();
  store.load();
  expect(store.error).toContain("操作ログが一致しません");
  expect(store.state).toBeUndefined();
  expect(write).not.toHaveBeenCalled();
  expect(values.get(key)).toBe(raw);
}, 20000);
