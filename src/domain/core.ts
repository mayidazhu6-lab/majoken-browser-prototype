import type { GameState, Log, Player } from "./types";
import { CONFIG } from "./config";
import { RECIPES } from "./items";
import { pick } from "./rng";
export function log(
  s: GameState,
  type: string,
  text: string,
  fields: Partial<Log> = {},
) {
  s.logs.push({
    seq: s.logs.length + 1,
    day: s.day,
    phase: s.phase,
    type,
    audience: "public",
    text,
    ...fields,
  });
}
export function fp(s: GameState, p: Player, amount: number, source: string) {
  const gain = Math.max(0, p.fp + amount) - p.fp;
  p.fp += gain;
  p.peakFp = Math.max(p.peakFp, p.fp);
  log(s, "fp", `${p.name} FP ${gain >= 0 ? "+" : ""}${gain}（${source}）`, {
    actor: p.id,
    amount: gain,
    kind: source,
    audience: ["scout", "ho"].includes(source) ? [p.id] : "public",
  });
  for (const t of CONFIG.thresholds) {
    if (p.peakFp < t || p.unlocks.includes(t)) continue;
    p.unlocks.push(t);
    const pool = RECIPES.filter(
      (r) => r.tier === "special" && !p.recipes.includes(r.id),
    );
    if (!pool.length) continue;
    if (t === 10 && !p.ai) {
      p.pendingRecipe = true;
    } else {
      const r = pick(s, pool, "特殊レシピ解放");
      p.recipes.push(r.id);
      log(s, "unlock", `${r.name}のレシピを解放`, {
        actor: p.id,
        kind: r.id,
        audience: [p.id],
      });
    }
  }
}
