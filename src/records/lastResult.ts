import type { GameState } from "../domain/types";
import { supportedRulesVersion } from "../domain/config";
import { endingPresentation, type EndingPresentation } from "../ui/ending";
export const LAST_RESULT_KEY = "majoken-last-result-v1";
export interface LastResult {
  format: "majoken-result";
  version: 1;
  id: string;
  rulesVersion: string;
  presentation: EndingPresentation;
}
export function captureResult(s: GameState): LastResult {
  let hash = 2166136261;
  for (const c of JSON.stringify(s.setup))
    hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return JSON.parse(
    JSON.stringify({
      format: "majoken-result",
      version: 1,
      id: `${s.rulesVersion}:${hash >>> 0}:${s.revision}`,
      rulesVersion: s.rulesVersion,
      presentation: endingPresentation(s),
    }),
  );
}
type Check = (x: any) => boolean;
const text: Check = (x) => typeof x === "string" && x.length <= 20000;
const bool: Check = (x) => typeof x === "boolean";
const int: Check = (x) => Number.isSafeInteger(x);
const nonnegative: Check = (x) => int(x) && x >= 0;
const player: Check = (x) => int(x) && x >= 0 && x < 4;
const optional =
  (f: Check): Check =>
  (x) =>
    x === undefined || f(x);
const array =
  (f: Check, max = 1000): Check =>
  (x) =>
    Array.isArray(x) && x.length <= max && x.every(f);
const object =
  (shape: Record<string, Check>): Check =>
  (x) =>
    x !== null &&
    typeof x === "object" &&
    !Array.isArray(x) &&
    Object.keys(x).every((k) => Object.hasOwn(shape, k)) &&
    Object.entries(shape).every(([k, f]) => f(x[k]));
const description = object({ name: text, condition: text });
const task = object({ day: nonnegative, id: nonnegative, achieved: bool });
const entry = object({
  order: nonnegative,
  day: (x) => x === 8,
  player,
  amount: int,
  reason: text,
  fpAfter: nonnegative,
  relatedPlayers: optional(array(player, 4)),
  eventId: optional(nonnegative),
  text,
});
const breakdown = object({
  player,
  start: nonnegative,
  end: nonnegative,
  change: int,
  entries: array(entry),
});
const row = object({
  player,
  rank: (x) => x === null || nonnegative(x),
  fp: nonnegative,
  daily: nonnegative,
  graduated: bool,
  name: text,
  outcome: text,
  status: text,
  rankText: text,
});
const summaryPlayer = object({
  player,
  name: text,
  fp: nonnegative,
  breakdown: optional(breakdown),
});
const model = object({
  day: (x) => int(x) && x >= 1 && x <= 8,
  collapsed: bool,
  hasChief: bool,
  rows: array(row, 4),
  summary: object({
    task: optional(task),
    reward: optional(int),
    taskName: text,
    night: array(object({ seq: nonnegative, text })),
    inventory: optional(
      (x) =>
        x !== null &&
        typeof x === "object" &&
        !Array.isArray(x) &&
        Object.keys(x).length <= 100 &&
        Object.values(x).every(int),
    ),
    players: array(summaryPlayer, 4),
  }),
  details: array(
    object({
      player,
      long: description,
      daily: array(
        object({
          day: nonnegative,
          id: nonnegative,
          achieved: bool,
          name: text,
          condition: text,
        }),
        8,
      ),
      unjudgedDay: bool,
    }),
    4,
  ),
});
export function decodeResult(raw: string): LastResult {
  if (raw.length > 2_000_000) throw Error("結果記録が大きすぎます");
  const r = JSON.parse(raw);
  const envelope = object({
    format: (x) => x === "majoken-result",
    version: (x) => x === 1,
    id: text,
    rulesVersion: (x) => text(x) && supportedRulesVersion(x),
    presentation: model,
  });
  const fail = () => {
    throw Error(
      "前回の結果の形式または内容を確認できません。元の記録は保持されています。",
    );
  };
  if (!envelope(r)) return fail();
  const p = r.presentation as EndingPresentation;
  const ids = (xs: { player: number }[]) =>
    xs.length === 4 && new Set(xs.map((x) => x.player)).size === 4;
  if (
    !ids(p.rows) ||
    !ids(p.details) ||
    !ids(p.summary.players) ||
    (!p.collapsed && p.day !== 8)
  )
    return fail();
  for (const row of p.rows) {
    const info = p.summary.players.find((x) => x.player === row.player)!;
    const detail = p.details.find((x) => x.player === row.player)!;
    if (
      info.name !== row.name ||
      info.fp !== row.fp ||
      row.daily !== detail.daily.filter((h) => h.achieved).length ||
      new Set(detail.daily.map((h) => h.day)).size !== detail.daily.length ||
      detail.daily.some((h) => h.day < 1 || h.day > p.day)
    )
      return fail();
    if (
      p.collapsed
        ? row.outcome !== "研究所崩壊" ||
          row.status !== "未判定" ||
          row.rank !== null ||
          row.graduated
        : row.graduated
          ? !["首席", "卒業"].includes(row.outcome) ||
            row.status !== "達成" ||
            row.rank === null ||
            row.rank < 1
          : row.outcome !== "落第" ||
            row.status !== "未達成" ||
            row.rank !== null
    )
      return fail();
    if (
      detail.daily.length !== (p.collapsed ? p.day - 1 : 8) ||
      (p.collapsed && detail.daily.some((h) => h.day >= p.day))
    )
      return fail();
    const expectedRank =
      p.collapsed || row.rank === null
        ? "順位なし"
        : `${p.rows.filter((q) => q.rank === row.rank).length > 1 ? "同率" : ""}${row.rank}位`;
    if (
      row.rankText !== expectedRank ||
      row.daily > 8 ||
      (row.rank !== null && (row.rank < 1 || row.rank > 4)) ||
      (!p.collapsed && (row.outcome === "首席") !== (row.rank === 1)) ||
      detail.unjudgedDay !== !detail.daily.some((h) => h.day === p.day)
    )
      return fail();
    const b = info.breakdown;
    if (
      b &&
      (b.player !== row.player ||
        b.end !== row.fp ||
        b.end - b.start !== b.change ||
        b.entries.reduce((n, e) => n + e.amount, 0) !== b.change ||
        b.entries.some((e) => e.player !== row.player || e.amount === 0))
    )
      return fail();
  }
  if (p.hasChief !== p.rows.some((x) => x.outcome === "首席")) return fail();
  return r;
}
export function encodeResult(r: LastResult) {
  const raw = JSON.stringify(r);
  decodeResult(raw);
  return raw;
}
