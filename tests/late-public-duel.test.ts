import { createHash } from "node:crypto";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, expect, it, vi } from "vitest";
import {
  V20_NPC_RULES_VERSION,
  V20_PREVIOUS_RULES_VERSION,
  V20_RULES_VERSION,
} from "../src/domain/config";
import { publicDuelReward } from "../src/domain/publicDuelReward";
import { createGame, dispatch } from "../src/domain/reducer";
import { startCombat } from "../src/domain/combat";
import { registerNight } from "../src/domain/night";
import { dailyAchieved } from "../src/domain/ho";
import { deserialize, replay, serialize } from "../src/domain/persistence";
import { simulationAction } from "../src/domain/simulation";
import { useGameStore } from "../src/stores/game";
import { ruleGuide } from "../src/ui/ruleGuide";
import fixture from "./fixtures/v203-late-duel.json" with { type: "json" };
import type { Action } from "../src/domain/types";
const setup = fixture.setup as Parameters<typeof createGame>[0];
const hash = (s: unknown) =>
  createHash("sha256").update(JSON.stringify(s)).digest("hex");
afterEach(() => vi.unstubAllGlobals());

for (const day of [1, 4, 5, 6, 7, 8])
  for (const winner of [0, 1]) {
    it(`awards ${day >= 5 ? 2 : 1} FP on day ${day} to ${winner === 0 ? "challenger" : "defender"} exactly once`, () => {
      let s = createGame(setup, V20_RULES_VERSION);
      s.day = day;
      s = dispatch(s, { type: "duel", player: 0, target: 1 });
      expect(s.players[0].ap).toBe(1);
      expect(s.players[1].ap).toBe(2);
      s = dispatch(s, { type: "loadout", player: 0, items: [] });
      s.combat!.hp = winner === 0 ? [12, 1] : [1, 12];
      const before = s.players.map((p) => p.fp);
      s = dispatch(s, { type: "elementRound", player: 0, element: "defense" });
      expect(s.combat!.winner).toBe(winner);
      expect(s.players.map((p, id) => p.fp - before[id])).toEqual(
        [0, 1, 2, 3].map((id) => (id === winner ? (day >= 5 ? 2 : 1) : 0)),
      );
      expect(
        s.logs.filter((l) => l.type === "fp" && l.kind === "duel"),
      ).toHaveLength(1);
      const awarded = s.players[winner].fp;
      s = dispatch(s, { type: "combatAck", player: 0 });
      expect(s.players[winner].fp).toBe(awarded);
      expect(() => dispatch(s, { type: "combatAck", player: 0 })).toThrow();
      expect(() =>
        dispatch(s, { type: "duel", player: 0, target: 1 }),
      ).toThrow();
    });
  }

it.each([1, 5, 8])("does not award FP for a draw on day %s", (day) => {
  let s = createGame(setup, V20_RULES_VERSION);
  s.day = day;
  s = dispatch(s, { type: "duel", player: 0, target: 1 });
  s = dispatch(s, { type: "loadout", player: 0, items: [] });
  s.combat!.hp = [1, 1];
  s = dispatch(s, { type: "elementRound", player: 0, element: "defense" });
  expect(s.combat!.winner).toBeNull();
  expect(s.logs.filter((l) => l.type === "fp" && l.kind === "duel")).toEqual(
    [],
  );
});

it("keeps surrender, mock and secret-combat FP unchanged", () => {
  let s = createGame(setup, V20_RULES_VERSION);
  s.day = 8;
  s.challenge = { from: 1, to: 0, mock: false };
  s = dispatch(s, {
    type: "challengeReply",
    player: 0,
    fight: false,
    items: [s.players[0].inventory[0].id],
  });
  expect(s.combat).toBeUndefined();
  expect(s.players.every((p) => p.fp === 0)).toBe(true);
  let mock = createGame(setup, V20_RULES_VERSION);
  mock.day = 5;
  startCombat(mock, 0, 1, "mock").hp = [12, 1];
  mock = dispatch(mock, {
    type: "elementRound",
    player: 0,
    element: "defense",
  });
  expect(mock.combat?.winner).toBe(0);
  expect(mock.players.every((p) => p.fp === 0)).toBe(true);
  let secret = createGame(setup, V20_RULES_VERSION);
  secret.day = 5;
  secret.phase = "night";
  for (const p of secret.players) p.night = { kind: "rest", recipes: [] };
  secret.players[0].night = { kind: "raid", target: 1, recipes: [] };
  secret.players[1].night = { kind: "guard", recipes: [] };
  registerNight(secret);
  startCombat(secret, 0, 1, "secret");
  secret = dispatch(secret, { type: "loadout", player: 0, items: [] });
  secret.combat!.hp = [12, 1];
  secret = dispatch(secret, {
    type: "elementRound",
    player: 0,
    element: "defense",
  });
  secret = dispatch(secret, { type: "elementReply", player: 0 });
  expect(secret.combat?.winner).toBe(0);
  expect(secret.players.every((p) => p.fp === 0)).toBe(true);
});

it("preserves the pre-change v2.0.3 day-five save and exact continuation hashes", () => {
  let s = replay(
    setup,
    fixture.actionsBeforeWin as Action[],
    V20_NPC_RULES_VERSION,
  );
  expect(hash(s)).toBe(fixture.beforeHash);
  expect(deserialize(serialize(s))).toEqual(s);
  const winnerFp = s.players[0].fp;
  s = dispatch(deserialize(serialize(s)), fixture.finishingAction as Action);
  expect(s.players[0].fp - winnerFp).toBe(1);
  expect(hash(s)).toBe(fixture.afterWinHash);
  s = dispatch(deserialize(serialize(s)), { type: "combatAck", player: 0 });
  expect(hash(s)).toBe(fixture.afterAckHash);
  expect(deserialize(serialize(s))).toEqual(s);
  for (const version of [V20_PREVIOUS_RULES_VERSION, V20_NPC_RULES_VERSION])
    expect(publicDuelReward({ day: 8, rulesVersion: version })).toBe(1);
});

it("changes only duel FP for identical combat inputs, preserving RNG, HP, win counts and HO conditions", () => {
  const old = replay(
    setup,
    fixture.actionsBeforeWin as Action[],
    V20_NPC_RULES_VERSION,
  );
  const current = replay(
    setup,
    fixture.actionsBeforeWin as Action[],
    V20_RULES_VERSION,
  );
  expect(current.players).toEqual(old.players);
  const a = dispatch(old, fixture.finishingAction as Action),
    b = dispatch(current, fixture.finishingAction as Action);
  expect(b.combatHistory).toEqual(a.combatHistory);
  expect(b.combat).toEqual(a.combat);
  expect([b.rng, b.draws]).toEqual([a.rng, a.draws]);
  expect(b.players.map((p, id) => p.fp - a.players[id].fp)).toEqual([
    1, 0, 0, 0,
  ]);
  for (const id of [12, 19, 20])
    expect(
      dailyAchieved(b, b.players[0], { id, targets: [], achieved: false }),
    ).toBe(
      dailyAchieved(a, a.players[0], { id, targets: [], achieved: false }),
    );
  expect(deserialize(serialize(b))).toEqual(b);
});

it("continues to final FP/ranking without changing daily HO rewards or final rank criteria", () => {
  let s = replay(
    setup,
    fixture.actionsBeforeWin as Action[],
    V20_RULES_VERSION,
  );
  s = dispatch(s, fixture.finishingAction as Action);
  for (let i = 0; i < 180 && !s.result; i++)
    s = dispatch(s, simulationAction(s));
  expect(s.result?.reason).toBe("completed");
  expect(s.day).toBe(8);
  expect(
    s.logs
      .filter((l) => l.type === "fp" && l.kind === "ho")
      .every((l) => l.amount === 1),
  ).toBe(true);
  for (const row of s.result!.ranking) {
    expect(row.fp).toBe(s.players[row.player].fp);
    const higher = s.result!.ranking.filter(
      (q) =>
        q.graduated &&
        (q.fp > row.fp || (q.fp === row.fp && q.daily > row.daily)),
    ).length;
    expect(row.rank).toBe(row.graduated ? higher + 1 : null);
  }
  expect(s.result!.chiefs).toEqual(
    s.result!.ranking.filter((row) => row.rank === 1).map((row) => row.player),
  );
  // Existing records provide the future balance-comparison inputs without new logging.
  for (const p of s.players) {
    const lateWins = s.logs.filter(
      (l) =>
        l.type === "win" &&
        l.actor === p.id &&
        l.day >= 5 &&
        l.day <= 8 &&
        l.data?.kind === "public",
    ).length;
    const lateFp = s.logs
      .filter(
        (l) =>
          l.type === "fp" &&
          l.actor === p.id &&
          l.kind === "duel" &&
          l.day >= 5,
      )
      .reduce((sum, l) => sum + (l.amount ?? 0), 0);
    expect(lateFp).toBe(lateWins * 2);
    expect(
      s.logs
        .filter((l) => l.type === "fp" && l.actor === p.id)
        .reduce((sum, l) => sum + (l.amount ?? 0), 0),
    ).toBe(p.fp);
    expect(typeof p.longGoal.achieved).toBe("boolean");
  }
  const events = s.logs.filter((l) => l.type === "eventResult");
  expect(events).toHaveLength(8);
  expect(events.every((l) => typeof l.data?.success === "boolean")).toBe(true);
  expect(deserialize(serialize(s))).toEqual(s);
});

it("keeps old/new save slots separate, including resaving an old reward", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  setActivePinia(createPinia());
  const store = useGameStore();
  store.start(setup);
  const fresh = values.get("majoken-save-rules-2.1");
  const old = replay(
    setup,
    fixture.actionsBeforeWin as Action[],
    V20_NPC_RULES_VERSION,
  );
  store.load(serialize(old));
  store.act(fixture.finishingAction as Action);
  store.save();
  expect(store.state?.rulesVersion).toBe(V20_NPC_RULES_VERSION);
  expect(hash(store.state)).toBe(fixture.afterWinHash);
  store.load(undefined, V20_NPC_RULES_VERSION);
  expect(hash(store.state)).toBe(fixture.afterWinHash);
  expect(values.get("majoken-save-rules-2.1")).toBe(fresh);
  expect(JSON.stringify(ruleGuide(V20_RULES_VERSION))).toContain(
    "5〜8日目は＋2FP",
  );
  expect(JSON.stringify(ruleGuide(V20_NPC_RULES_VERSION))).not.toContain(
    "5〜8日目は＋2FP",
  );
});
