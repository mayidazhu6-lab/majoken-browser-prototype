import { writeFileSync } from "node:fs";
import { createGame } from "../src/domain/reducer";
import { MATERIALS, CONFIG, RESEARCH } from "../src/domain/config";
import { RECIPES } from "../src/domain/items";
import { pick } from "../src/domain/rng";
import { startCombat, resolveRound, chooseStance } from "../src/domain/combat";
import type { Stats, Stance } from "../src/domain/types";
const setup = {
  name: "確率検証",
  seed: "distribution-v022",
  magic: "barrier" as const,
  stats: { attack: 4, defense: 3, insight: 3 },
};
const s = createGame(setup),
  counts = Object.fromEntries(MATERIALS.map((k) => [k, 0]));
for (let n = 0; n < 60000; n++) {
  counts[pick(s, MATERIALS, "採集素材")]++;
  if (n % 100 === 0) s.logs = [];
}
const distributions = Object.entries(counts).map(([kind, count]) => ({
  kind,
  count,
  rate: count / 60000,
  relativeDeviation: (count - 10000) / 10000,
}));
if (distributions.some((d) => Math.abs(d.relativeDeviation) > 0.05))
  throw Error("固定seedの採集分布が許容差5%を超えました");
const scenarios: { name: string; a: Stats; b: Stats; repeat?: boolean }[] = [
  {
    name: "同等能力AI同士",
    a: { attack: 4, defense: 3, insight: 3 },
    b: { attack: 4, defense: 3, insight: 3 },
  },
  {
    name: "育成済み対未育成AI",
    a: { attack: 9, defense: 6, insight: 6 },
    b: { attack: 2, defense: 3, insight: 3 },
  },
  {
    name: "攻撃特化対未育成AI",
    a: { attack: 9, defense: 3, insight: 3 },
    b: { attack: 2, defense: 3, insight: 3 },
  },
  {
    name: "同じ弱い相手へ2巡連続挑戦",
    a: { attack: 9, defense: 6, insight: 6 },
    b: { attack: 2, defense: 3, insight: 3 },
    repeat: true,
  },
];
const duels = scenarios.map((scenario) => {
  let wins = 0,
    losses = 0,
    draws = 0;
  for (let n = 0; n < 100; n++) {
    const state = createGame({ ...setup, seed: `duel-v022-${n}` });
    state.players[0].stats = { ...scenario.a };
    state.players[1].stats = { ...scenario.b };
    for (let fight = 0; fight < (scenario.repeat ? 2 : 1); fight++) {
      const c = startCombat(state, 0, 1, "public");
      while (!c.done) {
        const choices = c.participants.map((id, i) =>
          chooseStance(
            state.players[id].stats,
            state.players[c.participants[1 - i]].stats,
            c.charge[i],
            c.charge[1 - i],
            c.previous[i],
            [c.hp[i], c.hp[1 - i]],
            [],
            CONFIG.maxRounds - c.rounds.length,
          ),
        ) as [Stance, Stance];
        resolveRound(state, choices, [undefined, undefined]);
      }
      if (c.winner === 0) wins++;
      else if (c.winner === 1) losses++;
      else draws++;
    }
  }
  const attempts = wins + losses + draws;
  return {
    scenario: scenario.name,
    attempts,
    wins,
    losses,
    draws,
    challengerFPPerAP: wins / attempts,
    defenderFP: losses,
  };
});
const result = {
  rulesVersion: CONFIG.rulesVersion,
  draws: 60000,
  distributions,
  materialUses: MATERIALS.map((kind) => ({
    kind,
    research: Object.entries(RESEARCH)
      .filter(([, kinds]) => kinds.includes(kind))
      .map(([stat]) => stat),
    recipes: RECIPES.filter((r) => r.materials.includes(kind)).map((r) => r.id),
  })),
  duels,
  notes: [
    "採集と同一のpick(s, MATERIALS)を使用。出現率は変更しない。",
    "公開能力だけのchooseStance、薬・固有魔法なし、各戦闘HP20へリセット。勝敗のみ測定し、日次HO等の追加FPは含まない。",
    "AIは従来どおり挑戦を受け、降参しない。挑戦先の最適化・学習は行わない。",
    "勝者1FP/挑戦1APが上限だが、0APの被挑戦者にも勝者1FP。イベントは成功貢献で0AP納品から1〜2FP、研究は直接FPなしで成長・HOへ寄与。",
  ],
};
writeFileSync(
  "docs/reports/v022-balance.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
