import goals from "./goals.json" with { type: "json" };
import type { GameState, Goal, Player, Log } from "./types";
import { sample, pick } from "./rng";
import { STATS } from "./config";
import { eventProgress, EVENTS } from "./events";
export const LONG_GOALS = goals.long;
export const DAILY_GOALS = goals.daily;
export function dealGoals(s: GameState, long = false) {
  const pool = sample(
    s,
    long ? LONG_GOALS : DAILY_GOALS,
    4,
    long ? "長期HO配布" : "日次HO配布",
  );
  s.players.forEach((p, i) => {
    const id = pool[i].id;
    const targetCount = [13, 17].includes(id)
      ? 2
      : [1, 2, 5, 7, 9, 11, 18, 19].includes(id)
        ? 1
        : 0;
    const targets =
      long && targetCount > 0
        ? sample(
            s,
            s.players.filter((q) => q.id !== p.id).map((q) => q.id),
            targetCount,
            "HO指定対象",
          )
        : [];
    const g = { id, targets, achieved: false };
    if (long) p.longGoal = g;
    else p.dailyGoal = g;
  });
}
export function dailyAchieved(s: GameState, p: Player, g: Goal = p.dailyGoal) {
  const ls = s.logs.filter((l) => l.day === s.day && l.actor === p.id);
  const has = (t: string, pred: (l: Log) => boolean = () => true) =>
    ls.some((l) => l.type === t && pred(l));
  const sum = (t: string) =>
    ls.filter((l) => l.type === t).reduce((n, l) => n + (l.amount ?? 0), 0);
  const trade = ls.filter((l) => l.type === "trade");
  const battles = s.combatHistory.filter(
    (c) =>
      c.kind !== "mock" &&
      c.participants.includes(p.id) &&
      ls.some((l) => l.type === "combat" && l.data?.id === c.id),
  );
  const pub = battles.filter((c) => c.kind === "public");
  switch (g.id) {
    case 1:
      return has("research", (l) => (l.amount ?? 0) > 0);
    case 2:
      return ls.some(
        (l, i) =>
          l.type === "gather" &&
          ls
            .slice(i + 1)
            .some((v) => v.type === "research" || v.type === "brew"),
      );
    case 3:
      return has("brew");
    case 4:
      return sum("research") >= 2;
    case 5:
      return has("acquirePotion");
    case 6:
      return sum("gather") >= 2;
    case 7:
      return has("contribution");
    case 8:
      return trade.some((l) => (l.amount ?? 0) > 0);
    case 9:
      return new Set(trade.map((l) => l.target)).size >= 2;
    case 10:
      return trade.some((l) => (l.amount ?? 0) > 0 && l.data?.received === 0);
    case 11:
      return has("contribution") && ["gather", "research"].some((t) => has(t));
    case 12:
      return has("fp", (l) => (l.amount ?? 0) > 0 && l.kind !== "ho");
    case 13:
      return has("scout", (l) => (l.amount ?? 0) > 0);
    case 14:
      return has("loot", (l) => (l.amount ?? 0) > 0);
    case 15:
      return has("rest");
    case 16:
      return battles.some(
        (c) => c.kind === "secret" && c.initiator === p.id && c.winner === p.id,
      );
    case 17:
      return has("curseHit");
    case 18:
      return has("guard");
    case 19:
      return pub.length > 0;
    case 20:
      return pub.some((c) => c.winner === p.id);
    case 21:
      return pub.some((c) => {
        const i = c.participants.indexOf(p.id);
        return c.rounds.some((r) => r.damage[i] > r.damage[1 - i]);
      });
    case 22:
      return has("loot", (l) => (l.amount ?? 0) > 0) || has("command");
    case 23:
      return trade.length > 0 && pub.length > 0;
    case 24:
      return battles.some((c) => {
        const i = c.participants.indexOf(p.id);
        return c.rounds.some(
          (r, n) =>
            n >= 2 &&
            r.original[i] === c.rounds[n - 1].original[i] &&
            r.original[i] === c.rounds[n - 2].original[i],
        );
      });
    default:
      throw Error(`未定義日次HO ${g.id}`);
  }
}
/** Read-only estimate; the existing nightly evaluator remains authoritative. */
export function dailyProgress(s: GameState, p: Player) {
  const goal = p.dailyGoal;
  const ls = s.logs.filter((l) => l.day === s.day && l.actor === p.id);
  const facts = (type: string) => ls.filter((l) => l.type === type);
  const sum = (type: string) =>
    facts(type).reduce((n, l) => n + (l.amount ?? 0), 0);
  const has = (type: string) => facts(type).length > 0;
  const trades = facts("trade");
  const battles = s.combatHistory.filter(
    (c) =>
      c.kind !== "mock" &&
      c.participants.includes(p.id) &&
      facts("combat").some((l) => l.data?.id === c.id),
  );
  if (
    s.combat &&
    s.combat.kind !== "mock" &&
    s.combat.participants.includes(p.id) &&
    !battles.some((c) => c.id === s.combat!.id)
  )
    battles.push(s.combat);
  const pub = battles.filter((c) => c.kind === "public");
  const e = EVENTS[s.event.id - 1];
  const reserved = s.event.reservations.some(
    (r) =>
      r.player === p.id &&
      (((!e.either || !s.event.route || s.event.route === "materials") &&
        r.items.length > 0) ||
        ((!e.either || !s.event.route || s.event.route === "stats") &&
          Object.values(r.stats).some((n) => (n ?? 0) > 0))),
  );
  const candidate =
    reserved ||
    s.event.mock.includes(p.id) ||
    ls.some((l) => e.actions?.includes(l.type));
  const contribution =
    has("contribution") ||
    (!s.event.resolved && eventProgress(s).success && candidate);
  let current = 0,
    total = 1;
  let met = dailyAchieved(s, p);
  switch (goal.id) {
    case 1:
      current = Number(facts("research").some((l) => (l.amount ?? 0) > 0));
      break;
    case 2:
      total = 2;
      current = met ? 2 : Number(has("gather"));
      break;
    case 3:
      current = sum("brew");
      break;
    case 4:
      total = 2;
      current = sum("research");
      break;
    case 5:
      current = sum("acquirePotion");
      break;
    case 6:
      total = 2;
      current = sum("gather");
      break;
    case 7:
      current = Number(contribution || candidate);
      met = contribution;
      break;
    case 8:
      current = trades.reduce((n, l) => n + (l.amount ?? 0), 0);
      break;
    case 9:
      total = 2;
      current = new Set(trades.map((l) => l.target)).size;
      break;
    case 10:
      current = Number(
        trades.some((l) => (l.amount ?? 0) > 0 && l.data?.received === 0),
      );
      break;
    case 11:
      total = 2;
      current =
        Number(contribution || candidate) +
        Number(has("gather") || has("research"));
      met = contribution && (has("gather") || has("research"));
      break;
    case 12:
      current = facts("fp")
        .filter((l) => l.kind !== "ho" && (l.amount ?? 0) > 0)
        .reduce((n, l) => n + l.amount!, 0);
      break;
    case 13:
      current = sum("scout");
      break;
    case 14:
      current = sum("loot");
      break;
    case 15:
      current = Number(has("rest"));
      break;
    case 16:
      current = battles.filter(
        (c) => c.kind === "secret" && c.initiator === p.id && c.winner === p.id,
      ).length;
      break;
    case 17:
      current = facts("curseHit").length;
      break;
    case 18:
      current = Number(has("guard"));
      break;
    case 19:
      current = pub.length;
      met = current > 0;
      break;
    case 20:
      current = pub.filter((c) => c.winner === p.id).length;
      break;
    case 21:
      met = pub.some((c) => {
        const side = c.participants.indexOf(p.id);
        return c.rounds.some((r) => r.damage[side] > r.damage[1 - side]);
      });
      current = Number(met);
      break;
    case 22:
      current = Number(met);
      break;
    case 23:
      total = 2;
      current = Number(trades.length > 0) + Number(pub.length > 0);
      met = current === 2;
      break;
    case 24:
      total = 3;
      for (const c of battles) {
        const side = c.participants.indexOf(p.id);
        let streak = 0,
          previous: string | undefined;
        for (const r of c.rounds) {
          const choice = r.original[side];
          streak = choice === previous ? streak + 1 : 1;
          current = Math.max(current, streak);
          previous = choice;
        }
      }
      met = current >= total;
      break;
  }
  const judged = p.dailyHistory.find(
    (h) => h.day === s.day && h.id === goal.id,
  );
  const unjudgedCollapse =
    s.phase === "ended" && s.result?.reason === "collapse" && !judged;
  const status = unjudgedCollapse
    ? "判定なし・報酬なし"
    : judged?.achieved
      ? "達成確定"
      : !judged && met
        ? "達成見込み"
        : "未達成";
  return {
    status,
    current: Math.min(total, Math.max(0, current)),
    total,
    detail: unjudgedCollapse
      ? "研究所崩壊により本日の日次HOは最終判定されず、報酬は付与されません。"
      : judged
        ? "最終判定済みです。"
        : [7, 11].includes(goal.id) && !s.event.resolved && candidate
          ? "予約・行動は有効候補です。イベント成功と公開終了時の確定が必要です。"
          : "最終判定は夜のHO判定時に行います。",
  };
}

export function longAchieved(s: GameState, p: Player, g: Goal = p.longGoal) {
  const all = s.logs;
  const ls = all.filter((l) => l.actor === p.id);
  const target = g.targets[0];
  const q = s.players[target];
  const ts = (type: string, t?: number) =>
    ls.filter((l) => l.type === type && (t === undefined || l.target === t));
  const n = (type: string, t?: number) =>
    ts(type, t).reduce((a, l) => a + (l.amount ?? 1), 0);
  const battles = s.combatHistory.filter(
    (c) => c.kind !== "mock" && c.participants.includes(p.id),
  );
  const vs = (t: number) => battles.filter((c) => c.participants.includes(t));
  const wins = (t: number) => vs(t).filter((c) => c.winner === p.id).length;
  const scouts = (t: number) =>
    ts("scout", t).filter((l) => (l.amount ?? 0) > 0);
  const most = (values: number[], v: number, strict = true) =>
    values.every((x) => (strict ? v > x : v >= x));
  const others = s.players.filter((x) => x.id !== p.id);
  switch (g.id) {
    case 1:
      return p.fp >= q.fp + 2;
    case 2:
      return ts("trade", target).length >= 2 && wins(target) >= 1;
    case 3:
      return others.every((q) => n("receive", q.id) >= 2);
    case 5:
      return wins(target) >= 2;
    case 6:
      return most(
        others.map(
          (q) =>
            all.filter((l) => l.type === "contribution" && l.actor === q.id)
              .length,
        ),
        ts("contribution").length,
      );
    case 7:
      return scouts(target).length >= 2 && ts("trade", target).length >= 1;
    case 8:
      return n("givePotion") >= 3;
    case 9:
      return p.inventory.length > q.inventory.length;
    case 10:
      return new Set(ts("commandExecuted").map((l) => l.target)).size >= 2;
    case 11:
      return ts("curseHit", target).length > 0 && wins(target) >= 1;
    case 12:
      return (
        others.filter((q) =>
          scouts(q.id).some((l) =>
            ts("trade", q.id).some((t) => t.seq < l.seq),
          ),
        ).length >= 2
      );
    case 13:
      return (
        s.combatHistory.some(
          (c) =>
            c.kind === "public" &&
            g.targets.every((t) => c.participants.includes(t)),
        ) || others.every((q) => vs(q.id).length > 0)
      );
    case 16: {
      const a = others.some((q) =>
        scouts(q.id).some((l) =>
          s.combatHistory.some(
            (c) =>
              c.kind === "public" &&
              !c.participants.includes(p.id) &&
              c.participants.includes(q.id) &&
              c.winner !== null &&
              c.winner !== q.id &&
              all.some(
                (v) =>
                  v.type === "combat" && v.data?.id === c.id && v.seq < l.seq,
              ),
          ),
        ),
      );
      const b =
        others.reduce(
          (sum, q) =>
            sum +
            scouts(q.id).filter((l) =>
              all.some(
                (v) =>
                  v.type === "win" &&
                  v.actor === p.id &&
                  v.target === q.id &&
                  v.data?.initiator === p.id &&
                  v.seq < l.seq &&
                  (v.day < l.day || v.phase !== l.phase),
              ),
            ).length,
          0,
        ) >= 3;
      return a || b;
    }
    case 17:
      return (
        g.targets.every(
          (t) =>
            s.combatHistory.some(
              (c) =>
                c.kind === "public" &&
                c.participants.includes(t) &&
                c.winner !== null &&
                c.winner !== t,
            ) && p.fp > s.players[t].fp,
        ) ||
        most(
          others.map((q) => q.fp),
          p.fp,
        )
      );
    case 20:
      return (
        ts("defensiveWin").length >= 2 ||
        most(
          others.map((q) => q.stats.defense),
          p.stats.defense,
        )
      );
    case 21:
      return new Set(ts("rest").map((l) => l.day)).size >= 3;
    case 22:
      return STATS.some((k) =>
        most(
          others.map((q) => q.stats[k]),
          p.stats[k],
        ),
      );
    case 23:
      return new Set(ts("usePotion").map((l) => l.kind)).size >= 3;
    case 24:
      return (
        new Set(
          battles
            .filter((c) => c.winner !== null && c.winner !== p.id)
            .map((c) => c.participants.find((t) => t !== p.id)),
        ).size >= 2
      );
    case 25:
      return (
        p.inventory.length <= 2 &&
        most(
          others.map((q) => -q.inventory.length),
          -p.inventory.length,
          false,
        )
      );
    case 18:
      return (
        n("give", target) >= 3 &&
        most(
          others.map((q) => q.fp),
          p.fp,
          false,
        )
      );
    case 19:
      return wins(target) >= 2 && scouts(target).length >= 1;
    default:
      throw Error(`未定義長期HO ${g.id}`);
  }
}
export function goalDescription(g: Goal, long: boolean) {
  const d = (long ? LONG_GOALS : DAILY_GOALS).find((x) => x.id === g.id)!;
  return {
    ...d,
    condition:
      (!long && g.id === 14
        ? "当夜の秘匿決闘の勝利報酬で、アイテムを1個以上実獲得。"
        : !long && g.id === 21
          ? "当日の公開決闘で少なくとも1R、自分の被ダメージが相手より多い。"
          : !long && g.id === 20
            ? "当日の公開決闘で1回以上勝利（新戦闘の残HP／KOによる判定）。"
            : long && g.id === 3
              ? "他の3魔女それぞれから取引・譲渡・降参・決闘戦利品でアイテム累計2個以上獲得。消費後も実績保持。"
              : long && g.id === 20
                ? "異なる秘匿決闘で防衛側として累計2勝、または最終防御が全員中単独最多。"
                : d.condition
      )
        .replaceAll("通常窃盗", "成功偵察")
        .replaceAll("3ラウンド全部", "3R連続")
        .replaceAll("3ラウンド合計点", "残HP")
        .replaceAll("窃盗・", "偵察・") +
      (g.targets.length
        ? `（指定：${g.targets.map((n) => `席${n + 1}`).join("・")}）`
        : ""),
  };
}
// v0.1変換後も全46種は達成可能。除外候補はなし。
export const EXCLUDED_GOALS: number[] = [];
