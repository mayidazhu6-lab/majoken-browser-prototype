import { afterEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createGame } from "../src/domain/reducer";
import { replay, serialize } from "../src/domain/persistence";
import {
  captureResult,
  decodeResult,
  encodeResult,
  LAST_RESULT_KEY,
} from "../src/records/lastResult";
import { useGameStore } from "../src/stores/game";
import { useResultsStore } from "../src/stores/results";
import { day8Fixture, day8Setup } from "./fixtures/v21Day8";
import { completedFixture, collapseFixture } from "./fixtures/endings";
afterEach(() => vi.unstubAllGlobals());
function storage() {
  const values = new Map<string, string>(),
    writes: string[] = [];
  let reject = "",
    readFail = false;
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => {
      if (readFail && k === LAST_RESULT_KEY) throw Error("read");
      return values.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (k === reject) throw Error("quota");
      writes.push(k);
      values.set(k, v);
    },
  });
  setActivePinia(createPinia());
  return {
    values,
    writes,
    fail: (k = "") => (reject = k),
    readFail: (b: boolean) => (readFail = b),
  };
}
it("keeps a minimal frozen result snapshot and validates normal/collapse without replaying", () => {
  for (const s of [day8Fixture().after, collapseFixture()]) {
    const raw = encodeResult(captureResult(s));
    const r = decodeResult(raw);
    expect(r.presentation.rows).toHaveLength(4);
    expect(r.presentation.collapsed).toBe(s.result!.reason === "collapse");
    const obj = JSON.parse(raw);
    expect(Object.keys(obj).sort()).toEqual([
      "format",
      "id",
      "presentation",
      "rulesVersion",
      "version",
    ]);
    expect(raw).not.toMatch(
      /"rng"|"draws"|"actions"|"combatHistory"|"nightWork"|"magic"|"stats"|"setup"/,
    );
    expect(r.presentation.details[0].long.condition).toBeTruthy();
  }
}, 20000);
it.each(["{", "{}", '{"format":"majoken-save","version":2}', "null"])(
  "rejects invalid input %s",
  (raw) => expect(() => decodeResult(raw)).toThrow(),
);
it("rejects missing/extra fields, duplicate players, invalid FP and unrelated private data", () => {
  const valid = captureResult(day8Fixture().after);
  const mutations = [
    (x: any) => delete x.presentation.details,
    (x: any) => (x.presentation.rows[0].fp = -1),
    (x: any) => (x.presentation.rows[0].player = x.presentation.rows[1].player),
    (x: any) => (x.presentation.rng = 123),
    (x: any) => delete x.presentation.summary.players[0].fp,
    (x: any) => (x.presentation.rows[0].outcome = "fake"),
    (x: any) => (x.version = 99),
    (x: any) => (x.rulesVersion = "unknown"),
    (x: any) => x.presentation.details[0].daily.pop(),
    (x: any) => (x.presentation.rows[0].rankText = "99位"),
  ];
  for (const mutate of mutations) {
    const x = structuredClone(valid);
    mutate(x);
    expect(() => decodeResult(JSON.stringify(x))).toThrow();
  }
}, 20000);
it("writes game first, captures once on completion, and preserves record through new games", () => {
  const { values, writes } = storage();
  const { before, after } = day8Fixture();
  const key = "majoken-save-rules-2.1";
  values.set(key, serialize(before));
  const g = useGameStore();
  g.load();
  expect(values.has(LAST_RESULT_KEY)).toBe(false);
  g.act({ type: "advance", pauseAtDawn: true });
  expect(values.get(key)).toBe(serialize(after));
  const raw = values.get(LAST_RESULT_KEY)!;
  expect(decodeResult(raw)).toEqual(captureResult(after));
  expect(writes.slice(-2)).toEqual([key, LAST_RESULT_KEY]);
  g.save();
  expect(writes.filter((k) => k === LAST_RESULT_KEY)).toHaveLength(1);
  g.start({ ...day8Setup, seed: "new-research" });
  expect(values.get(LAST_RESULT_KEY)).toBe(raw);
  g.act({ type: "gather", player: 0 });
  expect(values.get(LAST_RESULT_KEY)).toBe(raw);
}, 20000);
it("game-save failure never publishes result early; retry uses identical candidate", () => {
  const m = storage();
  const { before, after } = day8Fixture(),
    key = "majoken-save-rules-2.1";
  m.values.set(key, serialize(before));
  const g = useGameStore();
  g.load();
  m.fail(key);
  g.act({ type: "advance", pauseAtDawn: true });
  expect(g.pending).toEqual(after);
  expect(m.values.has(LAST_RESULT_KEY)).toBe(false);
  m.fail();
  g.save();
  expect(g.state).toEqual(after);
  expect(decodeResult(m.values.get(LAST_RESULT_KEY)!)).toEqual(
    captureResult(after),
  );
}, 20000);
it("result-only failure preserves previous result and game, then retries identical bytes without game writes", () => {
  const m = storage();
  const { before, after } = day8Fixture(),
    key = "majoken-save-rules-2.1";
  const prior = encodeResult(captureResult(collapseFixture()));
  m.values.set(LAST_RESULT_KEY, prior);
  m.values.set(key, serialize(before));
  const g = useGameStore();
  g.load();
  m.fail(LAST_RESULT_KEY);
  g.act({ type: "advance", pauseAtDawn: true });
  const r = useResultsStore();
  expect(g.state).toEqual(after);
  expect(g.pending).toBeUndefined();
  expect(r.error).toBeTruthy();
  expect(m.values.get(LAST_RESULT_KEY)).toBe(prior);
  const pending = r.pending!;
  expect(pending).toBe(encodeResult(captureResult(after)));
  const game = m.values.get(key);
  m.writes.length = 0;
  m.fail();
  r.retry();
  expect(m.values.get(LAST_RESULT_KEY)).toBe(pending);
  expect(m.values.get(key)).toBe(game);
  expect(m.writes).toEqual([LAST_RESULT_KEY]);
  expect(r.pending).toBeUndefined();
  expect(g.state).toEqual(after);
}, 20000);
it("next research completion replaces the latest one result, including collapse", () => {
  const m = storage();
  const g = useGameStore();
  const first = day8Fixture();
  g.load(serialize(first.before));
  g.act({ type: "advance", pauseAtDawn: true });
  const firstRaw = m.values.get(LAST_RESULT_KEY);
  const collapse = collapseFixture();
  const before = replay(
    collapse.setup,
    collapse.actions.slice(0, -1),
    collapse.rulesVersion,
  );
  g.load(serialize(before));
  g.act(collapse.actions.at(-1)!);
  expect(m.values.get(LAST_RESULT_KEY)).not.toBe(firstRaw);
  expect(
    decodeResult(m.values.get(LAST_RESULT_KEY)!).presentation.collapsed,
  ).toBe(true);
}, 20000);
it.each([
  "browser-2.0",
  "browser-2.0.1",
  "browser-2.0.2",
  "browser-2.0.3",
  "browser-2.0.4",
])(
  "records newly completed %s, but never migrates a loaded old finished save",
  (version) => {
    const m = storage();
    const s = completedFixture(version),
      g = useGameStore();
    g.load(serialize(s));
    g.save();
    expect(m.values.has(LAST_RESULT_KEY)).toBe(false);
    const before = replay(s.setup, s.actions.slice(0, -1), version);
    expect(before.result).toBeUndefined();
    g.load(serialize(before));
    g.act(s.actions.at(-1)!);
    const r = decodeResult(m.values.get(LAST_RESULT_KEY)!);
    expect(r.rulesVersion).toBe(version);
    expect(r.presentation.rows.map((x) => x.fp).sort()).toEqual(
      s.result!.ranking.map((x) => x.fp).sort(),
    );
    expect(r.presentation.summary.players.every((p) => !p.breakdown)).toBe(
      true,
    );
  },
  20000,
);
it("corrupt and unreadable records remain untouched, and reading never loads a game", () => {
  const m = storage();
  const raw = "broken";
  m.values.set(LAST_RESULT_KEY, raw);
  const game = serialize(createGame(day8Setup, "browser-2.1"));
  m.values.set("majoken-save-rules-2.1", game);
  const r = useResultsStore();
  expect(r.saved).toBeUndefined();
  expect(r.readError).toBeTruthy();
  expect(m.values.get(LAST_RESULT_KEY)).toBe(raw);
  expect(m.writes).toEqual([]);
  expect(useGameStore().state).toBeUndefined();
  m.readFail(true);
  r.refresh();
  expect(r.readError).toBeTruthy();
  expect(m.values.get("majoken-save-rules-2.1")).toBe(game);
});
