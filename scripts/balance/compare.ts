import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  V20_NPC_RULES_VERSION,
  V20_RULES_VERSION,
} from "../../src/domain/config";
import { digest, extract, runAI4 } from "./ai4";

const count = Number(process.argv[2] ?? 100);
if (!Number.isInteger(count) || count < 1)
  throw Error("positive integer count required");
const prefix = process.argv[3] ?? "balance-v204";
const out = process.argv[4] ?? `docs/reports/balance-v204-${count}.json`;
type Row = ReturnType<typeof extract>;
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const ratio = (n: number, d: number) => ({ n, d, rate: d ? n / d : null });
const gap = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
const topGap = (xs: number[]) => {
  const a = [...xs].sort((a, b) => b - a);
  return a[0] - a[1];
};
export function summarize(rows: Row[]) {
  const complete = rows.filter((r) => r.reason === "completed");
  const reached4 = rows.filter((r) => r.fpDays[3]);
  const leaders = complete.flatMap((r) =>
    r.day4Leaders.map((id) => ({ r, id })),
  );
  const ranks: Record<string, number> = {};
  for (const { r, id } of leaders) {
    const rank = r.ranking.find((x) => x.player === id)!.rank;
    const key = rank === null ? "notGraduated" : String(rank);
    ranks[key] = (ranks[key] ?? 0) + 1;
  }
  const events = rows.flatMap((r) => r.events);
  const choices: Record<string, number> = {};
  for (const c of rows.flatMap((r) => r.publicChoices)) {
    const key = String(c.action);
    choices[key] = (choices[key] ?? 0) + 1;
  }
  return {
    games: rows.length,
    completed: ratio(complete.length, rows.length),
    collapse: ratio(rows.length - complete.length, rows.length),
    reached4: reached4.length,
    leaderRetention: ratio(
      leaders.filter(({ r, id }) => r.finalLeaders.includes(id)).length,
      leaders.length,
    ),
    anyLeaderRetention: ratio(
      complete.filter((r) =>
        r.day4Leaders.some((id) => r.finalLeaders.includes(id)),
      ).length,
      complete.length,
    ),
    reversal: ratio(
      complete.filter((r) =>
        r.finalLeaders.some((id) => !r.day4Leaders.includes(id)),
      ).length,
      complete.length,
    ),
    strictReversal: ratio(
      complete.filter(
        (r) => !r.day4Leaders.some((id) => r.finalLeaders.includes(id)),
      ).length,
      complete.length,
    ),
    leaderChief: ratio(
      leaders.filter(({ r, id }) => r.chiefs.includes(id)).length,
      leaders.length,
    ),
    leaderChiefAllReached4: ratio(
      reached4.flatMap((r) => r.day4Leaders).length
        ? reached4.reduce(
            (n, r) =>
              n + r.day4Leaders.filter((id) => r.chiefs.includes(id)).length,
            0,
          )
        : 0,
      reached4.flatMap((r) => r.day4Leaders).length,
    ),
    leaderRanks: ranks,
    noChief: ratio(
      complete.filter((r) => !r.chiefs.length).length,
      complete.length,
    ),
    longGoal: ratio(
      complete.flatMap((r) => r.longGoals).filter((g) => g.achieved).length,
      complete.length * 4,
    ),
    longGoalAllGames: ratio(
      rows.flatMap((r) => r.longGoals).filter((g) => g.achieved).length,
      rows.length * 4,
    ),
    eventSuccess: ratio(
      events.filter((e) => e.success === true).length,
      events.length,
    ),
    eventFailure: ratio(
      events.filter((e) => e.success === false).length,
      events.length,
    ),
    finalMeanFp: mean(complete.flatMap((r) => r.final)),
    finalRange: mean(complete.map((r) => gap(r.final))),
    finalTopGap: mean(complete.map((r) => topGap(r.final))),
    fpByDay: Array.from({ length: 8 }, (_, i) => {
      const days = rows.flatMap((r) => (r.fpDays[i] ? [r.fpDays[i]!] : []));
      return {
        day: i + 1,
        n: days.length,
        meanFp: mean(days.flat()),
        range: mean(days.map(gap)),
        topGap: mean(days.map(topGap)),
      };
    }),
    duels: rows.reduce((n, r) => n + r.duels.length, 0),
    wins: rows.reduce((n, r) => n + r.wins.length, 0),
    lateDuels: rows.reduce(
      (n, r) => n + r.duels.filter((x) => x.day >= 5).length,
      0,
    ),
    lateWins: rows.reduce(
      (n, r) => n + r.wins.filter((x) => x.day >= 5).length,
      0,
    ),
    leaderLateWinShare: ratio(
      complete.reduce(
        (n, r) =>
          n +
          r.wins.filter((w) => w.day >= 5 && r.day4Leaders.includes(w.player))
            .length,
        0,
      ),
      complete.reduce((n, r) => n + r.wins.filter((w) => w.day >= 5).length, 0),
    ),
    choices,
    reservations: rows.reduce((n, r) => n + r.cooperation.reservations, 0),
    contributions: rows.reduce((n, r) => n + r.cooperation.contributions, 0),
    chiefBySeat: [0, 1, 2, 3].map((id) =>
      ratio(
        complete.filter((r) => r.chiefs.includes(id)).length,
        complete.length,
      ),
    ),
  };
}

const old: Row[] = [],
  current: Row[] = [];
const pairing: {
  seed: string;
  initialEqual: boolean;
  day4Equal: boolean;
  publicChoicesEqual: boolean;
  eventsEqual: boolean;
  winsEqual: boolean;
  drawsEqual: boolean;
}[] = [];
for (let i = 0; i < count; i++) {
  const seed = `${prefix}-${String(i).padStart(4, "0")}`;
  const a = runAI4(seed, V20_NPC_RULES_VERSION),
    b = runAI4(seed, V20_RULES_VERSION);
  const ra = extract(a.state),
    rb = extract(b.state);
  const initialEqual = a.initial === b.initial;
  if (
    !initialEqual ||
    digest(ra.fpDays.slice(0, 4)) !== digest(rb.fpDays.slice(0, 4))
  )
    throw Error(`${seed}: unmatched initial/early conditions`);
  old.push(ra);
  current.push(rb);
  pairing.push({
    seed,
    initialEqual,
    day4Equal: digest(ra.fpDays[3]) === digest(rb.fpDays[3]),
    publicChoicesEqual: digest(ra.publicChoices) === digest(rb.publicChoices),
    eventsEqual: digest(ra.events) === digest(rb.events),
    winsEqual: digest(ra.wins) === digest(rb.wins),
    drawsEqual: ra.draws === rb.draws,
  });
  if ((i + 1) % 25 === 0) console.log(`${i + 1}/${count} pairs`);
}
// Re-run a complete pair independently, including logs/RNG-derived trace.
for (const version of [V20_NPC_RULES_VERSION, V20_RULES_VERSION]) {
  const reference = version === V20_NPC_RULES_VERSION ? old[0] : current[0];
  if (
    digest(extract(runAI4(reference.seed, version).state)) !== digest(reference)
  )
    throw Error("non-deterministic replay");
}
const result = {
  baseline: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  prefix,
  count,
  policy:
    "Test-only ai=true for seat0; fixed barrier/3,3,3; other seats use product setup; existing reducer AI decisions; no product changes",
  summary: {
    old: summarize(old),
    current: summarize(current),
    pairing: Object.fromEntries(
      [
        "initialEqual",
        "day4Equal",
        "publicChoicesEqual",
        "eventsEqual",
        "winsEqual",
        "drawsEqual",
      ].map((k) => [
        k,
        pairing.filter((p) => p[k as keyof typeof p] === true).length,
      ]),
    ),
  },
  old,
  current,
  pairing,
};
mkdirSync("docs/reports", { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result.summary, null, 2));
