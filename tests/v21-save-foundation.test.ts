import { createHash } from "node:crypto";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, expect, it, vi } from "vitest";
import {
  V21_RULES_VERSION,
  V20_RULES_VERSION,
  hasRandomElementAI,
  hasRevisedNightRules,
  hasPlaytestRules,
  hasGoalDrivenRewards,
  hasSharedCrisisPlanning,
  hasStrategyRules,
  hasFinalGoalRules,
  hasNightRules,
  hasElementCombat,
  isV20,
  supportedRulesVersion,
} from "../src/domain/config";
import { createGame, dispatch } from "../src/domain/reducer";
import { simulationAction } from "../src/domain/simulation";
import { deserialize, serialize } from "../src/domain/persistence";
import { publicDuelReward } from "../src/domain/publicDuelReward";
import { ruleGuide } from "../src/ui/ruleGuide";
import { useGameStore } from "../src/stores/game";
import baseline from "./fixtures/v21-legacy-replay.json" with { type: "json" };
import type { Setup } from "../src/domain/types";

const setup = baseline.setup as Setup;
const key = "majoken-save-rules-2.1";
const oldSlots = [
  ["browser-2.0", "majoken-save-rules-2.0-final"],
  ["browser-2.0.1", "majoken-save-rules-2.0.1"],
  ["browser-2.0.2", "majoken-save-rules-2.0.2"],
  ["browser-2.0.3", "majoken-save-rules-2.0.3"],
  ["browser-2.0.4", "majoken-save-rules-2.0.4"],
] as const;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
afterEach(() => vi.unstubAllGlobals());

function storage() {
  const values = new Map(
    oldSlots.map(([version, slot]) => [
      slot as string,
      serialize(createGame(setup, version)),
    ]),
  );
  const writes: string[] = [];
  let reject = false;
  vi.stubGlobal("localStorage", {
    getItem: (slot: string) => values.get(slot) ?? null,
    setItem: (slot: string, value: string) => {
      if (reject) throw Error("storage unavailable");
      writes.push(slot);
      values.set(slot, value);
    },
  });
  setActivePinia(createPinia());
  return {
    values,
    writes,
    fail: (value: boolean) => {
      reject = value;
    },
  };
}

it("recognizes v2.1 and inherits every existing modern feature gate", () => {
  expect(supportedRulesVersion(V21_RULES_VERSION)).toBe(true);
  for (const feature of [
    hasRandomElementAI,
    hasRevisedNightRules,
    hasPlaytestRules,
    hasGoalDrivenRewards,
    hasSharedCrisisPlanning,
    hasStrategyRules,
    hasFinalGoalRules,
    hasNightRules,
    hasElementCombat,
    isV20,
  ])
    expect(feature({ rulesVersion: V21_RULES_VERSION })).toBe(true);
  expect(supportedRulesVersion("browser-2.1-unknown")).toBe(false);
  expect(JSON.stringify(ruleGuide(V21_RULES_VERSION))).toContain(
    "5〜8日目は＋2FP",
  );
});

it("starts and resumes in the v2.1 slot without writing any of the five old slots", () => {
  const { values, writes } = storage();
  const old = new Map(values);
  const store = useGameStore();
  expect(store.v204RulesSaveAvailable).toBe(true);
  store.start(setup);
  expect(store.state?.rulesVersion).toBe(V21_RULES_VERSION);
  const saved = values.get(key)!;
  expect(JSON.parse(saved)).toMatchObject({
    format: "majoken-save",
    version: 2,
    state: { rulesVersion: V21_RULES_VERSION },
  });
  store.act({ type: "gather", player: 0 });
  store.load();
  expect(store.state?.rulesVersion).toBe(V21_RULES_VERSION);
  for (const [slot, value] of old) expect(values.get(slot)).toBe(value);
  expect(new Set(writes)).toEqual(new Set([key]));
});

it.each(oldSlots)(
  "loads, continues, resaves and imports %s only in its original slot",
  (version, slot) => {
    const { values, writes } = storage();
    const store = useGameStore();
    store.start(setup);
    const otherSlots = new Map(values);
    writes.length = 0;
    store.load(undefined, version);
    expect(store.state?.rulesVersion).toBe(version);
    expect(writes).toEqual([]);
    store.act({ type: "gather", player: 0 });
    const continued = serialize(store.state!);
    expect(deserialize(continued)).toEqual(store.state);
    store.save();
    store.load(continued);
    expect(serialize(store.state!)).toBe(continued);
    expect(new Set(writes)).toEqual(new Set([slot]));
    for (const [other, value] of otherSlots)
      if (other !== slot) expect(values.get(other)).toBe(value);
    store.load();
    expect(store.state?.rulesVersion).toBe(V21_RULES_VERSION);
  },
);

it("falls back to an existing 2.0.4 save when no v2.1 save exists", () => {
  const { writes } = storage();
  const store = useGameStore();
  store.load();
  expect(store.state?.rulesVersion).toBe(V20_RULES_VERSION);
  expect(writes).toEqual([]);
});

it("retains the previous save and retries the identical pending v2.1 result without drawing again", () => {
  const { values, writes, fail } = storage();
  const store = useGameStore();
  store.start(setup);
  const before = new Map(values);
  const initial = store.state;
  fail(true);
  store.act({ type: "gather", player: 0 });
  const pending = store.pending!;
  expect(pending).toBeDefined();
  const candidate = serialize(pending);
  expect(store.state).toBe(initial);
  expect(values).toEqual(before);
  expect(store.error).toContain("進行を停止");
  store.act({ type: "endTurn", player: 0 });
  store.start(setup);
  expect(serialize(store.pending!)).toBe(candidate);
  fail(false);
  store.save();
  expect(serialize(store.state!)).toBe(candidate);
  expect(values.get(key)).toBe(candidate);
  expect(store.pending).toBeUndefined();
  expect(deserialize(candidate)).toEqual(store.state);
  expect(new Set(writes)).toEqual(new Set([key]));
  for (const [slot, value] of before)
    if (slot !== key) expect(values.get(slot)).toBe(value);
});

for (const record of baseline.records) {
  it(`preserves the pre-change state chain, RNG, FP and HO results for ${record.rulesVersion}`, () => {
    let s = createGame(setup, record.rulesVersion);
    const chain = createHash("sha256");
    chain.update(serialize(s));
    let steps = 0;
    while (!s.result && steps++ < 1500) {
      s = dispatch(s, simulationAction(s));
      chain.update(serialize(s));
    }
    expect(steps).toBe(record.steps);
    expect(chain.digest("hex")).toBe(record.chainHash);
    expect(hash(serialize(s))).toBe(record.finalHash);
    expect([s.rng, s.draws]).toEqual([record.rng, record.draws]);
    expect(s.players.map((p) => p.fp)).toEqual(record.fp);
    expect(s.players.map((p) => p.longGoal.achieved)).toEqual(
      record.longAchieved,
    );
    expect(deserialize(serialize(s))).toEqual(s);
  });
}

it("changes only the version identity from 2.0.4 in phase 1, including full-game save replay", () => {
  let old = createGame(setup, V20_RULES_VERSION);
  let current = createGame(setup, V21_RULES_VERSION);
  const normalize = (value: typeof current) =>
    serialize(value).replaceAll(V21_RULES_VERSION, V20_RULES_VERSION);
  expect(normalize(current)).toBe(serialize(old));
  for (let i = 0; !old.result && i < 1500; i++) {
    const action = simulationAction(old);
    old = dispatch(old, action);
    current = dispatch(current, action);
    expect(normalize(current)).toBe(serialize(old));
  }
  expect(current.result).toBeDefined();
  expect(deserialize(serialize(current))).toEqual(current);
});

for (let day = 1; day <= 8; day++) {
  it.each([0, 1])(
    `awards the day-${day} v2.1 duel FP to either side exactly once`,
    (winner) => {
      let s = createGame(setup, V21_RULES_VERSION);
      s.day = day;
      s = dispatch(s, { type: "duel", player: 0, target: 1 });
      s = dispatch(s, { type: "loadout", player: 0, items: [] });
      s.combat!.hp = winner === 0 ? [12, 1] : [1, 12];
      const before = s.players.map((p) => p.fp);
      s = dispatch(s, { type: "elementRound", player: 0, element: "defense" });
      expect(s.combat!.winner).toBe(winner);
      expect(s.players.map((p, id) => p.fp - before[id])).toEqual(
        [0, 1, 2, 3].map((id) => (id === winner ? (day >= 5 ? 2 : 1) : 0)),
      );
      const fp = s.players[winner].fp;
      s = dispatch(s, { type: "combatAck", player: 0 });
      expect(s.players[winner].fp).toBe(fp);
    },
  );
}

it.each(oldSlots)(
  "keeps the original FP reward schedule for %s",
  (rulesVersion) => {
    for (let day = 1; day <= 8; day++)
      expect(publicDuelReward({ rulesVersion, day })).toBe(
        rulesVersion === V20_RULES_VERSION && day >= 5 ? 2 : 1,
      );
  },
);
