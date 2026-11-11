import { hasFinalGoalRules, V21_RULES_VERSION } from "../domain/config";
import { day8FpBreakdown } from "../domain/day8Fp";
import { EVENTS } from "../domain/events";
import { goalDescription } from "../domain/ho";
import type { GameState, Goal, Day8FpChange } from "../domain/types";
import { visibleToMe } from "./dailyReview";
import { uiText } from "./text";

export type EndingView = "summary" | "results";
export function endingView(s: GameState, selected: EndingView): EndingView {
  return s.result?.reason === "completed" && s.day === 8 ? selected : "results";
}
export function endingGoal(s: GameState, g: Goal, long: boolean) {
  const d = goalDescription(g, long, hasFinalGoalRules(s), s.rulesVersion);
  return {
    name: uiText(d.name),
    condition: uiText(d.condition).replace(
      /席(\d+)/g,
      (seat, n) => s.players[Number(n) - 1]?.name ?? seat,
    ),
  };
}
/** Uses stored ranks/chiefs only. Sorting is presentation, never a new judgment. */
export function endingRows(s: GameState) {
  if (!s.result) return [];
  const collapsed = s.result.reason === "collapse";
  return s.result.ranking
    .map((r) => ({
      ...r,
      name: s.players[r.player].name,
      outcome: collapsed
        ? "研究所崩壊"
        : s.result!.chiefs.includes(r.player)
          ? "首席"
          : r.graduated
            ? "卒業"
            : "落第",
      status: collapsed ? "未判定" : r.graduated ? "達成" : "未達成",
      rankText:
        collapsed || r.rank === null
          ? "順位なし"
          : `${s.result!.ranking.filter((q) => q.rank === r.rank).length > 1 ? "同率" : ""}${r.rank}位`,
    }))
    .sort((a, b) =>
      collapsed
        ? a.player - b.player
        : (a.outcome === "首席" ? 0 : a.graduated ? 1 : 2) -
            (b.outcome === "首席" ? 0 : b.graduated ? 1 : 2) ||
          (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
          a.player - b.player,
    );
}
export function fpReason(s: GameState, e: Day8FpChange) {
  const reasons: Record<string, string> = {
    duel: "公開決闘勝利",
    event: "共通イベント成功",
    ho: "日次HO成功",
    scout: "偵察による減点",
  };
  const related = e.relatedPlayers
    ?.map((id) => s.players[id]?.name)
    .filter(Boolean)
    .join("・");
  const event =
    e.eventId === undefined ? "" : EVENTS.find((x) => x.id === e.eventId)?.name;
  return (
    (reasons[e.reason] ?? "FP増減（理由記録なし）") +
    (event ? `（${event}）` : "") +
    (related ? `（${related}）` : "")
  );
}
/** Stored records only: no replay, no reconstruction of absent FP or inventory. */
export function endingSummary(s: GameState) {
  const task = s.players[0].dailyHistory.find((h) => h.day === 8);
  const logs = s.logs.filter(
    (l) => l.day === 8 && visibleToMe(l) && (l.actor === 0 || l.target === 0),
  );
  const allowed = [
    "nightChoice",
    "combat",
    "automaticBattle",
    "raidBlocked",
    "curseBlocked",
    "curseHit",
    "cursed",
    "rest",
    "guard",
    "scout",
    "scoutBlocked",
    "loot",
    "command",
    "brew",
    "usePotion",
  ];
  const night = logs.filter(
    (l) =>
      ["night", "duels", "rewards", "results"].includes(l.phase) &&
      allowed.includes(l.type) &&
      (l.type !== "combat" || l.actor === 0),
  );
  const inventory = logs.find(
    (l) => l.type === "nightInventory" && l.actor === 0,
  )?.data?.items as Record<string, number> | undefined;
  const reward = logs.filter(
    (l) => l.type === "fp" && l.kind === "ho" && l.actor === 0,
  );
  const fp = day8FpBreakdown(s);
  return {
    task,
    reward: reward.length
      ? reward.reduce((n, l) => n + (l.amount ?? 0), 0)
      : task?.achieved === false
        ? 0
        : undefined,
    night,
    inventory: inventory === undefined ? undefined : { ...inventory },
    players: s.players.map((p) => ({
      player: p.id,
      name: p.name,
      fp: s.result?.ranking.find((r) => r.player === p.id)?.fp ?? p.fp,
      breakdown: fp?.players.find((r) => r.player === p.id),
    })),
  };
}

/** Frozen display data, also usable without a GameState or a replay. */
export function endingPresentation(s: GameState) {
  if (!s.result || s.phase !== "ended") throw Error("終了結果が未確定です");
  const summary = endingSummary(s);
  return {
    day: s.day,
    collapsed: s.result.reason === "collapse",
    hasChief: s.result.chiefs.length > 0,
    rows: endingRows(s),
    summary: {
      ...summary,
      taskName: endingGoal(s, s.players[0].dailyGoal, false).name,
      night: summary.night.map((l) => ({ seq: l.seq, text: l.text })),
      players: summary.players.map((p) => ({
        ...p,
        breakdown: p.breakdown
          ? {
              ...p.breakdown,
              entries: p.breakdown.entries.map((e) => ({
                ...e,
                text: fpReason(s, e),
              })),
            }
          : undefined,
      })),
    },
    details: s.players.map((p) => ({
      player: p.id,
      long: endingGoal(s, p.longGoal, true),
      daily: p.dailyHistory.map((h) => ({
        ...h,
        ...endingGoal(
          s,
          { id: h.id, targets: [], achieved: h.achieved },
          false,
        ),
      })),
      unjudgedDay: !p.dailyHistory.some((h) => h.day === s.day),
    })),
  };
}
export type EndingPresentation = ReturnType<typeof endingPresentation>;

/** Render-only wording: preserve frozen snapshots and their validation unchanged. */
export function endingOutcome(
  data: Pick<EndingPresentation, "collapsed" | "rows">,
  row: EndingPresentation["rows"][number],
  rulesVersion?: string,
) {
  return rulesVersion === V21_RULES_VERSION &&
    !data.collapsed &&
    row.outcome === "首席" &&
    data.rows.filter((r) => r.outcome === "首席").length > 1
    ? "共同首席"
    : row.outcome;
}
