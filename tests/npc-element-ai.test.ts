import { createHash } from "node:crypto";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCombat } from "../src/domain/combat";
import {
  STATS,
  V20_PREVIOUS_RULES_VERSION,
  V20_RULES_VERSION,
} from "../src/domain/config";
import {
  chooseElement,
  resolveElementRound,
} from "../src/domain/elementCombat";
import { deserialize, serialize } from "../src/domain/persistence";
import { createGame, dispatch } from "../src/domain/reducer";
import { simulate } from "../src/domain/simulation";
import { useGameStore } from "../src/stores/game";
import fixture from "./fixtures/v202-combat-save.json" with { type: "json" };

const setup = {
  name: "アリア",
  seed: "v20-battle-36",
  magic: "barrier",
  stats: { attack: 3, defense: 3, insight: 3 },
} as const;
function battle(seed = setup.seed as string, version = V20_RULES_VERSION) {
  const s = createGame({ ...setup, seed }, version);
  for (const p of s.players) p.stats = { attack: 3, defense: 3, insight: 3 };
  const c = startCombat(s, 0, 1, "mock");
  return { s, c };
}
afterEach(() => vi.unstubAllGlobals());

describe("seeded highest-score NPC combat ties", () => {
  it("can choose all three equal-level elements across seeds and draws exactly once for a tie", () => {
    const chosen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const { s, c } = battle(`ai-tie-${i}`);
      const before = s.draws;
      chosen.add(chooseElement(c, s, 1));
      expect(s.draws).toBe(before + 1);
      expect(s.logs.at(-1)).toMatchObject({
        type: "rng",
        audience: "dev",
        data: { candidates: STATS },
      });
    }
    expect([...chosen].sort()).toEqual([...STATS].sort());
  });

  it("reproduces the choice, RNG and audit log from identical state without inspecting the opponent input", () => {
    const { s, c } = battle();
    const other = structuredClone(s);
    c.elemental!.pending = { player: 0, element: "attack" };
    other.combat!.elemental!.pending = { player: 0, element: "defense" };
    expect(chooseElement(c, s, 1)).toBe(chooseElement(other.combat!, other, 1));
    expect([s.rng, s.draws, s.logs]).toEqual([
      other.rng,
      other.draws,
      other.logs,
    ]);
  });

  it.each(STATS)(
    "keeps %s as the unique higher-Lv choice without a random draw",
    (stat) => {
      const { s, c } = battle();
      s.players[1].stats[stat] = 6;
      const before = [s.rng, s.draws, s.logs.length];
      expect(chooseElement(c, s, 1)).toBe(stat);
      expect([s.rng, s.draws, s.logs.length]).toEqual(before);
    },
  );

  it("randomizes only between the two highest elements", () => {
    const choices = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const { s, c } = battle(`two-ties-${i}`);
      s.players[1].stats = { attack: 3, defense: 6, insight: 6 };
      choices.add(chooseElement(c, s, 1));
      expect(s.logs.at(-1)?.data?.candidates).toEqual(["defense", "insight"]);
    }
    expect([...choices].sort()).toEqual(["defense", "insight"]);
  });

  it("keeps own-potion advantage and the remaining-HP cap in the existing evaluation", () => {
    const { s, c } = battle();
    c.brought[1] = [{ id: 999, kind: "ice" }];
    const before = s.draws;
    expect(chooseElement(c, s, 1)).toBe("defense");
    expect(s.draws).toBe(before);
    c.brought[1] = [];
    s.players[1].stats.defense = 6;
    c.hp[0] = 1;
    chooseElement(c, s, 1);
    expect(s.draws).toBe(before + 1);
    expect(s.logs.at(-1)?.data?.candidates).toEqual(STATS);
  });

  it("preserves old ties without consuming RNG for the old save version", () => {
    for (let i = 0; i < 30; i++) {
      const { s, c } = battle(`legacy-${i}`, V20_PREVIOUS_RULES_VERSION);
      const before = JSON.stringify(s);
      expect(chooseElement(c, s, 1)).toBe("attack");
      expect(JSON.stringify(s)).toBe(before);
    }
  });

  it("keeps damage, simultaneous KO and winner judgments identical for fixed combat inputs", () => {
    for (const left of STATS)
      for (const right of STATS) {
        const states = [V20_PREVIOUS_RULES_VERSION, V20_RULES_VERSION].map(
          (version) => {
            const { s, c } = battle("damage-check", version);
            c.hp = [2, 2];
            resolveElementRound(s, [left, right], [undefined, undefined]);
            return {
              hp: c.hp,
              done: c.done,
              winner: c.winner,
              rounds: c.elemental!.rounds,
            };
          },
        );
        expect(states[0]).toEqual(states[1]);
      }
  });
});

it("replays a pre-change v2.0.2 save and produces the exact pre-change continuation", () => {
  let s = deserialize(JSON.stringify(fixture.save));
  expect(s).toEqual(fixture.save.state);
  s = deserialize(serialize(s));
  while (!s.combat!.done)
    s = dispatch(s, { type: "elementRound", player: 0, element: "defense" });
  s = dispatch(s, { type: "combatAck", player: 0 });
  expect(createHash("sha256").update(JSON.stringify(s)).digest("hex")).toBe(
    fixture.continuedSHA256,
  );
  expect(deserialize(serialize(s))).toEqual(s);
});

it("reproduces a full new game and reloads new AI RNG state without repeating draws", () => {
  const s = simulate("npc-ai-replay", V20_RULES_VERSION);
  expect(
    s.logs.some(
      (l) => l.type === "rng" && l.text === "NPC戦闘属性の最高評価同点抽選",
    ),
  ).toBe(true);
  expect(simulate("npc-ai-replay", V20_RULES_VERSION)).toEqual(s);
  expect(deserialize(serialize(deserialize(serialize(s))))).toEqual(s);
});

it("keeps old and new save slots and AI versions separate through load, continue, save and reload", () => {
  const oldKey = "majoken-save-rules-2.0.2",
    newKey = "majoken-save-rules-2.0.3";
  const old = JSON.stringify(fixture.save);
  const values = new Map([[oldKey, old]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  setActivePinia(createPinia());
  const store = useGameStore();
  store.load();
  expect(store.state?.rulesVersion).toBe(V20_PREVIOUS_RULES_VERSION);
  store.start(setup);
  expect(store.state?.rulesVersion).toBe(V20_RULES_VERSION);
  expect(values.get(oldKey)).toBe(old);
  const fresh = values.get(newKey);
  store.load(undefined, V20_PREVIOUS_RULES_VERSION);
  store.act({ type: "elementRound", player: 0, element: "defense" });
  const continued = serialize(store.state!);
  store.save();
  store.load();
  expect(store.state?.rulesVersion).toBe(V20_RULES_VERSION);
  expect(values.get(newKey)).toBe(fresh);
  store.load(undefined, V20_PREVIOUS_RULES_VERSION);
  expect(serialize(store.state!)).toBe(continued);
  expect(values.get(oldKey)).toBe(continued);
  expect(values.get(newKey)).toBe(fresh);
});

it("continues the new AI identically after repeated mid-combat save/load cycles", () => {
  let uninterrupted = createGame(setup, V20_RULES_VERSION);
  uninterrupted = dispatch(uninterrupted, {
    type: "duel",
    player: 0,
    target: 1,
  });
  uninterrupted = dispatch(uninterrupted, {
    type: "loadout",
    player: 0,
    items: [],
  });
  let resumed = deserialize(serialize(uninterrupted));
  while (!uninterrupted.combat!.done) {
    const action = {
      type: "elementRound",
      player: 0,
      element: "defense",
    } as const;
    uninterrupted = dispatch(uninterrupted, action);
    resumed = dispatch(deserialize(serialize(resumed)), action);
    resumed = deserialize(serialize(resumed));
    expect(resumed).toEqual(uninterrupted);
  }
  uninterrupted = dispatch(uninterrupted, { type: "combatAck", player: 0 });
  resumed = dispatch(resumed, { type: "combatAck", player: 0 });
  expect(deserialize(serialize(resumed))).toEqual(uninterrupted);
});
