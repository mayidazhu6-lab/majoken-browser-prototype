import { mkdirSync, writeFileSync } from "node:fs";
import { simulate } from "../src/domain/simulation";
import { CONFIG } from "../src/domain/config";
const seeds = process.argv.slice(2);
if (!seeds.length) seeds.push("witches-2026", "moon-42", "lab-77");
const results = seeds.map((seed) => {
  const s = simulate(seed);
  return {
    seed,
    day: s.day,
    reason: s.result!.reason,
    completed: s.result!.reason === "completed",
    collapse: s.result!.reason === "collapse",
    graduates: s.result!.graduates,
    chiefs: s.result!.chiefs,
    players: s.players.map((p) => ({
      name: p.name,
      stats: p.stats,
      fp: p.fp,
      longHO: p.longGoal.id,
      longAchieved: p.longGoal.achieved,
      dailyAchieved: p.dailyHistory.filter((h) => h.achieved).length,
    })),
    combats: s.combatHistory.map((c) => ({
      kind: c.kind,
      winner: c.winner,
      rounds: c.rounds.length,
      hp: c.hp,
      participants: c.participants,
    })),
    fpHistory: s.logs
      .filter((l) => l.type === "fp")
      .map((l) => ({
        day: l.day,
        player: l.actor,
        delta: l.amount,
        source: l.kind,
      })),
    growth: s.logs
      .filter((l) => l.type === "research")
      .map((l) => ({
        day: l.day,
        player: l.actor,
        stat: l.kind,
        amount: l.amount,
      })),
    actions: s.actions.length,
  };
});
const summary = {
  seeds: results.length,
  completionRate: results.filter((r) => r.completed).length / results.length,
  collapseRate: results.filter((r) => r.collapse).length / results.length,
  longHOAchievementRate:
    results.flatMap((r) => r.players).filter((p) => p.longAchieved).length /
    (results.length * 4),
  dailyHOAchievementRate:
    results.flatMap((r) => r.players).reduce((n, p) => n + p.dailyAchieved, 0) /
    results.reduce((n, r) => n + (r.completed ? 8 : r.day - 1) * 4, 0),
};
mkdirSync("docs/reports", { recursive: true });
writeFileSync(
  "docs/reports/simulation.json",
  JSON.stringify(
    {
      rulesVersion: CONFIG.rulesVersion,
      policy: "cooperative human bot + three normal AI (unmodified rules)",
      summary,
      results,
    },
    null,
    2,
  ),
);
const rows = [
  "seed,day,reason,player,attack,defense,insight,fp,longHO,longAchieved,dailyAchieved",
];
for (const r of results)
  for (const p of r.players)
    rows.push(
      [
        r.seed,
        r.day,
        r.reason,
        p.name,
        p.stats.attack,
        p.stats.defense,
        p.stats.insight,
        p.fp,
        p.longHO,
        p.longAchieved,
        p.dailyAchieved,
      ].join(","),
    );
writeFileSync("docs/reports/simulation.csv", rows.join("\n") + "\n");
console.log(JSON.stringify(summary, null, 2));
for (const r of results)
  console.log(`${r.seed}: day ${r.day}, ${r.reason}, ${r.actions} actions`);
