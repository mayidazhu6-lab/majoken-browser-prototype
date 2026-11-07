import { expect, it } from "vitest";
import { createGame, dispatch } from "../src/domain/reducer";
import { simulationAction } from "../src/domain/simulation";
import { V20_RULES_VERSION } from "../src/domain/config";
import { deserialize, serialize } from "../src/domain/persistence";
import { dailyAchieved, longAchieved } from "../src/domain/ho";
import { graduationProgress } from "../src/ui/graduationProgress";
import { nightReadiness } from "../src/ui/nightReadiness";
import { registerNight } from "../src/domain/night";
import type { GameState, Goal, Action } from "../src/domain/types";
const setup = {
  name: "アリア",
  seed: "win-audit-1",
  magic: "barrier",
  stats: { attack: 3, defense: 3, insight: 3 },
} as const;
const goal = (id: number, target = 2): Goal => ({
  id,
  targets: [target],
  achieved: false,
});
function progress(s: GameState, g: Goal) {
  const view = structuredClone(s);
  view.players[0].longGoal = g;
  return graduationProgress(view).join("\n");
}

it("records each Nemu secret win immediately, including defense, and keeps HO/UI counts through repeated save/load", () => {
  let s = createGame(setup, V20_RULES_VERSION);
  const snapshots: GameState[] = [];
  for (let i = 0; i < 250 && !s.result; i++) {
    let a: Action = simulationAction(s);
    if (s.phase === "night" && !s.players[0].night)
      a = {
        type: "night",
        player: 0,
        choice: {
          kind: s.players[0].lastRaid === s.day - 1 ? "guard" : "raid",
          target: s.day <= 3 ? 2 : 1,
          recipes: [],
        },
      };
    if (a.type === "advance") a = { ...a, pauseAtDawn: true };
    const previous = s;
    s = dispatch(s, a);
    const wins = s.combatHistory.filter(
      (c) => c.kind === "secret" && c.winner === 0,
    );
    const oldWins = previous.combatHistory.filter(
      (c) => c.kind === "secret" && c.winner === 0,
    );
    if (wins.length === oldWins.length) continue;
    const latest = wins.at(-1)!;
    expect(
      s.logs.filter(
        (l) =>
          l.type === "win" &&
          l.actor === 0 &&
          l.target === latest.participants.find((id) => id !== 0) &&
          l.data?.kind === "secret",
      ).length,
    ).toBeGreaterThan(0);
    const nemu = s.combatHistory.filter(
      (c) => c.kind !== "mock" && c.winner === 0 && c.participants.includes(2),
    ).length;
    expect(progress(s, goal(5))).toContain(`指定相手への勝利 ${nemu}回`);
    expect(longAchieved(s, s.players[0], goal(5))).toBe(nemu >= 2);
    expect(longAchieved(s, s.players[0], goal(19))).toBe(
      nemu >= 2 &&
        s.logs.some(
          (l) =>
            l.type === "scout" &&
            l.actor === 0 &&
            l.target === 2 &&
            (l.amount ?? 0) > 0,
        ),
    );
    expect(longAchieved(s, s.players[0], goal(2))).toBe(
      nemu >= 1 &&
        s.logs.filter(
          (l) => l.type === "trade" && l.actor === 0 && l.target === 2,
        ).length >= 2,
    );
    expect(longAchieved(s, s.players[0], goal(11))).toBe(
      nemu >= 1 &&
        s.logs.some(
          (l) => l.type === "curseHit" && l.actor === 0 && l.target === 2,
        ),
    );
    const saved = serialize(s);
    s = deserialize(saved);
    expect(serialize(deserialize(serialize(s)))).toBe(saved);
    expect(progress(s, goal(5))).toContain(`指定相手への勝利 ${nemu}回`);
    snapshots.push(s);
  }
  const wins = s.combatHistory.filter(
    (c) => c.kind === "secret" && c.winner === 0,
  );
  expect(wins.filter((c) => c.participants.includes(2))).toHaveLength(2);
  expect(wins.filter((c) => c.participants.includes(1))).toHaveLength(2);
  expect(wins.some((c) => c.initiator === 0)).toBe(true);
  expect(wins.some((c) => c.initiator !== 0)).toBe(true);
  expect(snapshots).toHaveLength(4);
  expect(s.result?.reason).toBe("completed");
}, 20000);

it("combines public and secret wins against the same target but excludes mock, draws, losses and another target", () => {
  const s = createGame(setup, V20_RULES_VERSION);
  const base = { id: 1, participants: [0, 2], kind: "secret", winner: 0 };
  // Only the fields consumed by the existing counter matter in these classification cases.
  s.combatHistory = [
    base,
    { ...base, id: 2, kind: "public" },
    { ...base, id: 3, kind: "mock" },
    { ...base, id: 4, winner: null },
    { ...base, id: 5, winner: 2 },
    { ...base, id: 6, participants: [0, 1] },
  ] as GameState["combatHistory"];
  expect(progress(s, goal(5))).toContain("指定相手への勝利 2回");
  expect(longAchieved(s, s.players[0], goal(5))).toBe(true);
  expect(progress(s, goal(5, 1))).toContain("指定相手への勝利 1回");
  expect(longAchieved(s, s.players[0], goal(5, 1))).toBe(false);
});

it("does not count a rest-target automatic result or a victory alone as L10 command completion", () => {
  const s = createGame(setup, V20_RULES_VERSION);
  s.phase = "night";
  for (const p of s.players) p.night = { kind: "rest", recipes: [] };
  s.players[0].night = { kind: "raid", target: 2, recipes: [] };
  registerNight(s);
  expect(s.nightWork?.battles).toContainEqual(
    expect.objectContaining({
      automatic: true,
      winner: 0,
      participants: [0, 2],
    }),
  );
  expect(s.combatHistory).toHaveLength(0);
  expect(longAchieved(s, s.players[0], goal(5))).toBe(false);
  expect(dailyAchieved(s, s.players[0], goal(16))).toBe(false);
  expect(longAchieved(s, s.players[0], goal(10))).toBe(false);
  expect(progress(s, goal(10))).toContain("命令を実行させた相手 0 / 2人");
});

it("guards resolution until everyone confirms, and rejects saving, wrong phases and repeated resolution without exposing choices", () => {
  const s = createGame(setup, V20_RULES_VERSION);
  s.phase = "night";
  for (const p of s.players) p.night = undefined;
  expect(nightReadiness(s).canResolve).toBe(false);
  s.players[0].night = { kind: "rest", recipes: [] };
  expect(nightReadiness(s)).toMatchObject({
    selfConfirmed: true,
    allConfirmed: false,
    canResolve: false,
  });
  for (const p of s.players.slice(1))
    p.night = { kind: "curse", target: 0, recipes: [] };
  expect(nightReadiness(s).canResolve).toBe(true);
  expect(nightReadiness(s, true).canResolve).toBe(false);
  expect(Object.keys(nightReadiness(s).confirmations[1]).sort()).toEqual([
    "confirmed",
    "id",
    "name",
  ]);
  s.phase = "ho";
  expect(nightReadiness(s).canResolve).toBe(false);
});
