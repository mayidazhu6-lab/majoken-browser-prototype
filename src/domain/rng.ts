import type { GameState } from "./types";
export function hashSeed(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function random(s: GameState) {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  s.draws++;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function pick<T>(
  s: GameState,
  values: readonly T[],
  reason = "抽選",
): T {
  if (!values.length) throw Error("抽選候補がありません");
  const index = Math.floor(random(s) * values.length);
  s.logs.push({
    seq: s.logs.length + 1,
    day: s.day,
    phase: s.phase,
    type: "rng",
    audience: "dev",
    text: reason,
    data: {
      draw: s.draws,
      candidates: structuredClone(values),
      index,
      result: structuredClone(values[index]),
    },
  });
  return values[index];
}
export function sample<T>(
  s: GameState,
  values: readonly T[],
  n: number,
  reason?: string,
) {
  const pool = [...values],
    out: T[] = [];
  while (out.length < n && pool.length) {
    const v = pick(s, pool, reason);
    out.push(v);
    pool.splice(pool.indexOf(v), 1);
  }
  return out;
}
