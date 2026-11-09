import { autoVictoryFixture } from "./fixtures/v21AutoVictory";
import { deserialize, serialize } from "../src/domain/persistence";
import { createPinia, setActivePinia } from "pinia";
import { useGameStore } from "../src/stores/game";
import {
  dailyAchieved,
  dailyProgress,
  longAchieved,
  goalDescription,
} from "../src/domain/ho";
import { graduationProgress } from "../src/ui/graduationProgress";
import { selectStrategy, strategyView } from "../src/domain/strategy";
import { startCombat } from "../src/domain/combat";
import { log } from "../src/domain/core";
import { expect, it, vi } from "vitest";
import { createGame, dispatch } from "../src/domain/reducer";
import { duelHistory, recordAutomaticVictory } from "../src/domain/duelHistory";
import { V21_RULES_VERSION } from "../src/domain/config";
import type { GameState, Goal, Action, Setup } from "../src/domain/types";

const setup: Setup = {
  name: "アリア",
  seed: "auto-victory-1",
  magic: "barrier",
  stats: { attack: 3, defense: 3, insight: 3 },
};
function night(version: string = V21_RULES_VERSION) {
  const s = createGame(setup, version);
  s.phase = "night";
  s.day = 8;
  for (const p of s.players) {
    p.night = { kind: "guard", recipes: [] };
    p.inventory = [];
  }
  s.players[0].night = { kind: "raid", target: 2, recipes: [] };
  s.players[2].night = { kind: "rest", recipes: [] };
  return s;
}

function autoWithoutReward() {
  const s = night();
  s.day = 5;
  s.players[2].commands = [
    { from: 1, kind: "choice", qualifies: false },
    { from: 3, kind: "choice", qualifies: false },
  ];
  return dispatch(s, { type: "advance" });
}

it("records one automatic victory and attacker participation, without fabricating a Combat or consuming RNG", () => {
  const s = night();
  const rng = [s.rng, s.draws];
  const after = dispatch(s, { type: "advance" });
  expect(after.phase).toBe("ho");
  expect([after.rng, after.draws]).toEqual(rng);
  expect(after.combatHistory).toEqual([]);
  expect(after.combat).toBeUndefined();
  expect(duelHistory(after)).toEqual([
    {
      id: 1,
      kind: "secret",
      opponents: [0, 2],
      participants: [0],
      winner: 0,
      hasRounds: false,
    },
  ]);
  expect(
    after.logs.filter((l) => l.type === "win" && l.actor === 0),
  ).toHaveLength(1);
  expect(after.logs.some((l) => l.type === "rest" && l.actor === 2)).toBe(
    false,
  );
  expect(duelHistory(after).filter((r) => r.participants.includes(2))).toEqual(
    [],
  );
  expect(
    duelHistory(after).filter(
      (r) => r.winner !== 2 && r.participants.includes(2),
    ),
  ).toEqual([]);
});

it.each([
  "browser-2.0",
  "browser-2.0.1",
  "browser-2.0.2",
  "browser-2.0.3",
  "browser-2.0.4",
])("does not add automatic victory records to %s", (version) => {
  const s = dispatch(night(version), { type: "advance" });
  expect(duelHistory(s)).toEqual([]);
  expect(s.nextCombat).toBe(1);
  expect(s.logs.filter((l) => l.type === "win")).toEqual([]);
});

it("is idempotent for the same raid and gives separate raids unique shared combat IDs", () => {
  const s = autoWithoutReward();
  const before = JSON.stringify(s);
  recordAutomaticVictory(s, [0, 2]);
  expect(JSON.stringify(s)).toBe(before);
  recordAutomaticVictory(s, [1, 2]);
  expect(duelHistory(s).map((r) => r.id)).toEqual([1, 2]);
  const copy = structuredClone(s.logs.find((l) => l.type === "win")!);
  s.logs.push(copy);
  expect(duelHistory(s)).toHaveLength(2);
  s.day++;
  recordAutomaticVictory(s, [0, 2]);
  expect(duelHistory(s).filter((r) => r.winner === 0)).toHaveLength(2);
  expect(new Set(duelHistory(s).map((r) => r.id)).size).toBe(3);
});

it("records simultaneous raids separately, but mutual raids remain a real round combat", () => {
  const s = night();
  s.players[1].night = { kind: "raid", target: 2, recipes: [] };
  s.players[3].night = { kind: "raid", target: 2, recipes: [] };
  const after = dispatch(s, { type: "advance" });
  expect(duelHistory(after).map((r) => r.winner)).toEqual([0, 1, 3]);
  expect(after.combatHistory).toEqual([]);
  const mutual = night();
  mutual.players[2].night = { kind: "raid", target: 0, recipes: [] };
  const started = dispatch(mutual, { type: "advance" });
  expect(started.combat?.kind).toBe("secret");
  expect(started.logs.filter((l) => l.data?.automatic === true)).toEqual([]);
});

it("counts D16 now, grants its FP only at the formal daily evaluation, and never repeats it", () => {
  const start = night();
  start.players[0].dailyGoal = { id: 16, targets: [], achieved: false };
  const s = dispatch(start, { type: "advance" });
  const p = s.players[0];
  expect(dailyAchieved(s, p)).toBe(true);
  expect(dailyProgress(s, p).current).toBe(1);
  expect(p.dailyGoal.achieved).toBe(false);
  expect(p.fp).toBe(0);
  const ended = dispatch(s, { type: "advance", pauseAtDawn: true });
  expect(ended.players[0].fp).toBe(1);
  expect(ended.players[0].dailyHistory.filter((h) => h.day === 8)).toEqual([
    { day: 8, id: 16, achieved: true },
  ]);
  expect(() => dispatch(ended, { type: "advance" })).toThrow();
  const otherDay = structuredClone(s);
  otherDay.day = 7;
  expect(dailyAchieved(otherDay, otherDay.players[0])).toBe(false);
});

const goal = (id: number, target = 2): Goal => ({
  id,
  targets: [target],
  achieved: false,
});
function progress(s: GameState, id: number, target = 2) {
  const v = structuredClone(s);
  v.players[0].longGoal = goal(id, target);
  return graduationProgress(v).join(" | ");
}
function fact(s: GameState, type: string, target = 2) {
  log(s, type, "test fact", { actor: 0, target, amount: 1, audience: [0] });
}

it("counts repeated target wins but retains all L02/L05/L11/L19 additional conditions", () => {
  const s = autoWithoutReward();
  const p = s.players[0];
  expect(longAchieved(s, p, goal(5))).toBe(false);
  expect(progress(s, 5)).toContain("勝利 1回 / 必要2回");
  expect(longAchieved(s, p, goal(2))).toBe(false);
  fact(s, "trade");
  expect(longAchieved(s, p, goal(2))).toBe(false);
  fact(s, "trade");
  expect(longAchieved(s, p, goal(2))).toBe(true);
  expect(longAchieved(s, p, goal(11))).toBe(false);
  fact(s, "curseHit");
  expect(longAchieved(s, p, goal(11))).toBe(true);
  expect(longAchieved(s, p, goal(19))).toBe(false);
  s.day++;
  recordAutomaticVictory(s, [0, 2]);
  expect(longAchieved(s, p, goal(5))).toBe(true);
  expect(longAchieved(s, p, goal(19))).toBe(false);
  fact(s, "scout");
  expect(longAchieved(s, p, goal(19))).toBe(true);
  expect(progress(s, 19)).toContain("勝利 2回 / 必要2回");
  for (const id of [2, 5, 11, 19])
    expect(longAchieved(s, p, goal(id, 1))).toBe(false);
  expect(p.longGoal.achieved).toBe(false);
});

it("L13 counts distinct performed opponents, including draws, without granting resting-side participation", () => {
  const s = autoWithoutReward();
  const g = { id: 13, targets: [1, 2], achieved: false };
  s.players[0].longGoal = g;
  s.day++;
  recordAutomaticVictory(s, [0, 2]);
  expect(graduationProgress(s).join()).toContain("対戦した相手 1 / 3人");
  expect(longAchieved(s, s.players[0])).toBe(false);
  s.day++;
  recordAutomaticVictory(s, [0, 1]);
  expect(longAchieved(s, s.players[0])).toBe(false);
  // A completed round-based draw against the third opponent still satisfies performance.
  const c = startCombat(s, 0, 3, "secret");
  c.done = true;
  c.winner = null;
  c.elemental!.rounds = [
    {
      sides: [
        {
          element: "attack",
          affinity: 0,
          levelBonus: 0,
          potionBonus: 0,
          calculated: 2,
          dealt: 2,
        },
        {
          element: "attack",
          affinity: 0,
          levelBonus: 0,
          potionBonus: 0,
          calculated: 2,
          dealt: 2,
        },
      ],
      hp: [10, 10],
    },
  ];
  s.combatHistory.push(structuredClone(c));
  s.combat = undefined;
  expect(longAchieved(s, s.players[0])).toBe(true);
  expect(graduationProgress(s).join()).toContain("対戦した相手 3 / 3人");
  s.players[2].longGoal = { id: 13, targets: [0, 1], achieved: false };
  expect(longAchieved(s, s.players[2])).toBe(false);
  expect(duelHistory(s).filter((r) => r.participants.includes(2))).toHaveLength(
    0,
  );
});

it("does not create round/public/defense/loss HO credit or L10 command qualification", () => {
  const s = night();
  s.day = 1;
  s.players[0].dailyGoal = goal(16);
  s.players[0].longGoal = goal(10);
  const resolved = dispatch(s, { type: "advance" });
  expect(resolved.phase).toBe("rewards");
  const commanded = dispatch(resolved, {
    type: "nightReward",
    player: 0,
    command: "choice",
  });
  expect(commanded.players[2].commands[0]).toMatchObject({
    from: 0,
    qualifies: false,
  });
  log(commanded, "commandExecuted", "test execution", {
    actor: 0,
    target: 2,
    data: { qualifies: false },
    audience: [0, 2],
  });
  expect(longAchieved(commanded, commanded.players[0], goal(10))).toBe(false);
  expect(progress(commanded, 10)).toContain("相手 0 / 2人");
  for (const id of [19, 20, 21, 23, 24])
    expect(dailyAchieved(commanded, commanded.players[0], goal(id))).toBe(
      false,
    );
  for (const id of [20, 24]) {
    expect(longAchieved(commanded, commanded.players[0], goal(id))).toBe(false);
    expect(longAchieved(commanded, commanded.players[2], goal(id))).toBe(false);
  }
  expect(commanded.logs.filter((l) => l.type === "defensiveWin")).toEqual([]);
  expect(dailyAchieved(commanded, commanded.players[0], goal(22))).toBe(true);
  expect(dailyAchieved(commanded, commanded.players[0], goal(14))).toBe(false);
});

it("combines public and normal secret wins with auto wins once, while excluding mock and losses", () => {
  const s = dispatch(night(), { type: "advance" });
  for (const kind of ["public", "secret", "mock"] as const) {
    const c = startCombat(s, 0, 2, kind);
    c.done = true;
    c.winner = kind === "secret" ? 2 : 0;
    s.combatHistory.push(structuredClone(c));
  }
  s.combat = undefined;
  const records = duelHistory(s);
  expect(records).toHaveLength(3);
  expect(records.filter((r) => r.winner === 0)).toHaveLength(2);
  expect(longAchieved(s, s.players[0], goal(5))).toBe(true);
  expect(progress(s, 5)).toContain("勝利 2回");
});

it("AI completion evaluation sees only its own auto victories through the existing private view", () => {
  const s = night();
  s.day = 5;
  s.players[1].longGoal = goal(5);
  s.players[1].dailyGoal = goal(18);
  recordAutomaticVictory(s, [1, 2]);
  const candidates = [
    {
      action: { type: "night", player: 1, choice: { kind: "guard" } } as Action,
    },
  ];
  selectStrategy(s, s.players[1], candidates, false);
  expect(s.logs.at(-1)?.data?.primary).toBe("long");
  s.day++;
  recordAutomaticVictory(s, [1, 2]);
  const view = strategyView(s, 1);
  expect(longAchieved(view, view.players[1])).toBe(true);
  selectStrategy(s, s.players[1], candidates, false);
  expect(s.logs.at(-1)?.data?.primary).toBe("daily");
  expect(duelHistory(strategyView(s, 3))).toHaveLength(0);
});

it("uses v2.1-only approved goal descriptions and leaves old descriptions unchanged", () => {
  for (const id of [16, 20])
    expect(
      goalDescription(goal(id), false, true, V21_RULES_VERSION).condition,
    ).not.toBe(
      goalDescription(goal(id), false, true, "browser-2.0.4").condition,
    );
  for (const id of [2, 5, 10, 11, 13, 19])
    expect(
      goalDescription(goal(id), true, true, V21_RULES_VERSION).condition,
    ).not.toBe(
      goalDescription(goal(id), true, true, "browser-2.0.4").condition,
    );
  expect(
    goalDescription(goal(10), true, true, V21_RULES_VERSION).condition,
  ).toContain("ラウンドあり");
  expect(
    goalDescription(goal(20), false, true, V21_RULES_VERSION).condition,
  ).toContain("第5〜8日＋2");
  expect(
    goalDescription(goal(16), false, true, "browser-2.0.4").condition,
  ).not.toContain("自動勝利");
});

it.each(["attacker", "resting", "third"] as const)(
  "strictly replays real %s auto-victory saves without changing credit, RNG or progress",
  (role) => {
    const { before, after } = autoVictoryFixture(role);
    expect(deserialize(serialize(before))).toEqual(before);
    const raw = serialize(after);
    const restored = deserialize(raw);
    expect(serialize(restored)).toBe(raw);
    expect(duelHistory(restored)).toEqual(duelHistory(after));
    expect(graduationProgress(restored)).toEqual(graduationProgress(after));
    expect([restored.rng, restored.draws]).toEqual([after.rng, after.draws]);
    const auto = after.logs.filter(
      (l) => l.type === "win" && l.data?.automatic === true,
    );
    expect(auto.length).toBeGreaterThan(0);
    for (const entry of auto) {
      const r = duelHistory(after).find((r) => r.id === entry.data!.id)!;
      expect(r.hasRounds).toBe(false);
      expect(r.participants).toEqual([entry.actor]);
      expect(after.combatHistory.some((c) => c.id === r.id)).toBe(false);
    }
    const notice = after.logs.filter(
      (l) => l.type === "automaticBattle" && l.day === after.day,
    );
    for (const entry of notice) {
      expect(entry.audience).toEqual([entry.actor]);
      expect(entry.target).toBeDefined();
      expect(entry.text).toContain(after.players[entry.target!].name);
    }
    const third = strategyView(after, role === "third" ? 0 : 1);
    for (const entry of auto.filter(
      (l) => !(l.audience as number[]).includes(role === "third" ? 0 : 1),
    ))
      expect(third.logs.some((l) => l.seq === entry.seq)).toBe(false);
    if (role === "attacker") {
      expect(after.players[0].longGoal).toMatchObject({ id: 5, targets: [2] });
      const count = duelHistory(after).filter(
        (r) => r.winner === 0 && r.opponents.includes(2),
      ).length;
      expect(graduationProgress(after).join()).toContain(`勝利 ${count}回`);
    }
  },
);

it("retains a pending automatic-victory result on storage failure and retries without duplicating it", () => {
  const { before } = autoVictoryFixture("resting");
  const values = new Map([["majoken-save-rules-2.1", serialize(before)]]);
  let reject = false;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (reject) throw Error("quota");
      values.set(key, value);
    },
  });
  try {
    setActivePinia(createPinia());
    const store = useGameStore();
    store.load();
    reject = true;
    store.act({ type: "advance" });
    const pending = store.pending!;
    expect(pending).toBeDefined();
    expect(duelHistory(pending).some((r) => !r.hasRounds)).toBe(true);
    const candidate = serialize(pending);
    expect(values.get("majoken-save-rules-2.1")).toBe(serialize(before));
    store.act({ type: "advance" });
    expect(serialize(store.pending!)).toBe(candidate);
    reject = false;
    store.save();
    expect(serialize(store.state!)).toBe(candidate);
    expect(serialize(deserialize(values.get("majoken-save-rules-2.1")!))).toBe(
      candidate,
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

it("barrier-blocked raids do not create auto-win or participation credit", () => {
  const s = night();
  s.barriers = [2];
  const after = dispatch(s, { type: "advance" });
  expect(duelHistory(after)).toHaveLength(0);
  expect(after.logs.filter((l) => l.type === "automaticBattle")).toHaveLength(
    0,
  );
  expect(after.logs.some((l) => l.type === "rest" && l.actor === 2)).toBe(true);
});

it("keeps every auto victory when only the first same-night attacker can loot the last item", () => {
  const s = night();
  s.players[1].night = { kind: "raid", target: 2, recipes: [] };
  s.players[3].night = { kind: "raid", target: 2, recipes: [] };
  s.players[2].inventory = [{ id: s.nextItem++, kind: "herb" }];
  const rng = [s.rng, s.draws];
  const pending = dispatch(s, { type: "advance" });
  expect(pending.phase).toBe("rewards");
  expect([pending.rng, pending.draws]).toEqual(rng);
  expect(duelHistory(pending)).toHaveLength(3);
  const done = dispatch(pending, {
    type: "nightReward",
    player: 0,
    randomLoot: true,
  });
  expect(done.phase).toBe("ho");
  expect(done.draws).toBe(s.draws + 1);
  expect(done.players[0].inventory).toHaveLength(1);
  expect(done.players[2].inventory).toHaveLength(0);
  for (const actor of [0, 1, 3]) {
    expect(dailyAchieved(done, done.players[actor], goal(16))).toBe(true);
    expect(dailyAchieved(done, done.players[actor], goal(14))).toBe(
      actor === 0,
    );
    expect(dailyAchieved(done, done.players[actor], goal(22))).toBe(
      actor === 0,
    );
  }
  expect(done.players.map((p) => p.fp)).toEqual([0, 0, 0, 0]);
  expect(duelHistory(done)).toHaveLength(3);
});
