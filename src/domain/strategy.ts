import { log } from "./core";
import { dailyAchieved, longAchieved } from "./ho";
import { pick } from "./rng";
import type { Action, GameState, Player } from "./types";

export interface StrategyCandidate {
  action: Action;
  cost?: number;
  event?: number;
  completesEvent?: boolean;
}

export function strategyView(s: GameState, player: number): GameState {
  const sees = (audience: GameState["logs"][number]["audience"]) =>
    audience === "public" ||
    (Array.isArray(audience) && audience.includes(player));
  return {
    ...s,
    setup: { ...s.setup, magic: s.players[player].magic },
    actions: [],
    votes: {},
    trades: s.trades.filter((t) => t.from === player || t.to === player),
    challenge: undefined,
    publicOutcome: undefined,
    barriers: [],
    nightWork: undefined,
    duelQueue: [],
    combat: undefined,
    combatHistory: s.combatHistory.filter(
      (c) => c.kind !== "secret" || c.participants.includes(player),
    ),
    event: {
      ...s.event,
      reservations: s.event.reservations.filter((r) => r.player === player),
    },
    logs: s.logs.filter((l) => sees(l.audience)),
    players: s.players.map((p) =>
      p.id === player
        ? p
        : ({
            id: p.id,
            name: p.name,
            ai: p.ai,
            fp: p.fp,
            ap: p.ap,
            stats: p.stats,
            inventory: p.inventory.map(() => ({ id: -1, kind: "" })),
          } as Player),
    ),
  };
}

function remainingDays(s: GameState, p: Player) {
  return 8 - s.day + Number(s.phase === "public" || !p.night);
}

export function longImpossible(s: GameState, p: Player) {
  const days = remainingDays(s, p);
  const scouts = (id: number) =>
    new Set(
      s.logs
        .filter(
          (l) => l.actor === p.id && l.type === "scout" && l.target === id,
        )
        .map((l) => l.day),
    ).size;
  switch (p.longGoal.id) {
    case 7:
      return scouts(p.longGoal.targets[0]) + days < 2;
    case 10:
      return s.day === 8 && s.phase === "night" && !longAchieved(s, p);
    case 16:
      if (s.day !== 8 || s.phase !== "night") return false;
      if (longAchieved(s, p)) return false;
      return (
        !s.combatHistory.some(
          (c) =>
            c.kind === "public" &&
            !c.participants.includes(p.id) &&
            c.winner != null,
        ) &&
        !s.players.some(
          (q) =>
            q.id !== p.id &&
            s.logs.some(
              (l) =>
                l.actor === p.id &&
                l.target === q.id &&
                l.type === "win" &&
                l.data?.kind === "public" &&
                l.data.initiator === p.id &&
                s.logs.filter(
                  (scout) =>
                    scout.actor === p.id &&
                    scout.target === q.id &&
                    scout.type === "scout" &&
                    scout.seq > l.seq,
                ).length +
                  days >=
                  3,
            ),
        )
      );
    case 19:
      return scouts(p.longGoal.targets[0]) + days < 1;
    case 21:
      return (
        new Set(
          s.logs
            .filter((l) => l.actor === p.id && l.type === "rest")
            .map((l) => l.day),
        ).size +
          days <
        3
      );
    default:
      return false;
  }
}

function intendedTarget(p: Player, target: number) {
  return p.longGoal.targets.length === 0 || p.longGoal.targets.includes(target);
}

function goalProgress(
  s: GameState,
  p: Player,
  action: Action,
  long: boolean,
): number {
  const id = long ? p.longGoal.id : p.dailyGoal.id;
  switch (action.type) {
    case "trade":
      if (long)
        return intendedTarget(p, action.target) &&
          [2, 3, 7, 8, 9, 12, 18, 25].includes(id)
          ? 1
          : 0;
      return [5, 7, 8, 9, 10, 23].includes(id) ? 1 : 0;
    case "duel":
      if (action.mock) return 0;
      if (long)
        return intendedTarget(p, action.target) &&
          [1, 2, 5, 11, 13, 16, 17, 18, 19, 24].includes(id)
          ? 1
          : 0;
      return [12, 19, 20, 21, 23, 24].includes(id) ? 1 : 0;
    case "reserve":
      return long ? (id === 6 ? 1 : 0) : [11, 12].includes(id) ? 1 : 0;
    case "gather":
      return long
        ? [3, 8, 9, 22, 23].includes(id)
          ? 1
          : 0
        : [2, 6, 11].includes(id)
          ? 1
          : 0;
    case "research":
      if (!long) return [1, 2, 4, 11].includes(id) ? 1 : 0;
      if ([20, 22].includes(id)) {
        const margin =
          p.stats[action.stat] -
          Math.max(
            ...s.players
              .filter((q) => q.id !== p.id)
              .map((q) => q.stats[action.stat]),
          );
        return margin === 0 ? 4 : margin >= 1 ? 3 : 2;
      }
      return id === 23 && action.stat === "insight" ? 1 : 0;
    case "night": {
      const { kind, target, recipes = [] } = action.choice;
      if (!long) {
        if ((id === 3 || id === 5 || id === 2) && recipes.length) return 2;
        return (
          {
            13: "scout",
            14: "raid",
            15: "rest",
            16: "raid",
            17: "curse",
            18: "guard",
            22: "raid",
            24: "raid",
          } as Record<number, string>
        )[id] === kind
          ? 1
          : 0;
      }
      if (kind === "rest") return id === 21 ? 2 : 0;
      if (kind === "guard") return id === 20 ? 1 : 0;
      if (target === undefined || !intendedTarget(p, target)) return 0;
      if (kind === "scout") return [7, 12, 16, 19].includes(id) ? 2 : 0;
      if (kind === "curse") return id === 11 ? 2 : 0;
      return [2, 3, 5, 9, 10, 11, 13, 19, 20, 24, 25].includes(id) &&
        (id !== 10 || s.day < 8)
        ? 1
        : 0;
    }
    default:
      return 0;
  }
}

function certainDaily(s: GameState, p: Player, action: Action) {
  // Project only the facts a legal action creates without an opponent or a random outcome.
  const add = (type: string, amount: number) => ({
    day: s.day,
    actor: p.id,
    type,
    amount,
  });
  const facts =
    action.type === "research"
      ? [add("research", p.publicPotions?.includes("scholarship") ? 2 : 1)]
      : action.type === "gather"
        ? [
            add(
              "gather",
              2 +
                Number(p.rest >= (p.ap === 2 ? 1 : 2)) -
                Number(p.curse >= (p.ap === 2 ? 1 : 2)) +
                Number(!!p.publicPotions?.includes("abundance")),
            ),
          ]
        : action.type === "night" && action.choice.recipes?.length
          ? [add("brew", 1), add("acquirePotion", 1)]
          : [];
  return (
    facts.length > 0 &&
    dailyAchieved({ ...s, logs: [...s.logs, ...facts] as GameState["logs"] }, p)
  );
}

export function selectStrategy(
  s: GameState,
  p: Player,
  candidates: StrategyCandidate[],
  viableEvent: boolean,
) {
  const view = strategyView(s, p.id);
  const impossible = longImpossible(view, p);
  const longDone =
    ![1, 6, 9, 17, 18, 20, 22, 25].includes(p.longGoal.id) &&
    longAchieved(view, p);
  const crisis =
    s.failed === 2 && viableEvent && candidates.some((c) => (c.event ?? 0) > 0);
  const primary = crisis ? "event" : impossible || longDone ? "daily" : "long";
  const dailyDone = dailyAchieved(view, p);
  const ranked = candidates.map((c) => {
    const daily = dailyDone
      ? 0
      : certainDaily(view, p, c.action)
        ? 2
        : Math.min(1, goalProgress(view, p, c.action, false));
    const lastResearch =
      c.action.type === "research" &&
      s.day === 8 &&
      s.publicTurn.round === 2 &&
      s.publicTurn.index === s.publicTurn.order.length - 1 &&
      ![6, 11, 12].includes(s.event.id)
        ? c.action.stat
        : undefined;
    const certainlyLong =
      p.longGoal.id === 22 &&
      lastResearch !== undefined &&
      view.players.every(
        (q) =>
          q.id === p.id ||
          p.stats[lastResearch] +
            1 +
            Number(!!p.publicPotions?.includes("scholarship")) >
            q.stats[lastResearch],
      );
    const long = longDone
      ? 0
      : certainlyLong
        ? 5
        : goalProgress(view, p, c.action, true);
    const event = c.completesEvent ? 2 : (c.event ?? 0);
    const main =
      primary === "event"
        ? [event, long, daily]
        : primary === "daily"
          ? [daily, event, long]
          : [long, event, daily];
    return { c, key: [...main, -(c.cost ?? 0)] };
  });
  const compare = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
    return 0;
  };
  ranked.sort((a, b) => compare(a.key, b.key));
  const best = ranked.filter((r) => compare(r.key, ranked[0].key) === 0);
  const selected =
    best.length === 1 ? best[0] : pick(s, best, "AI同順位の抽選");
  log(s, "aiReason", `AI優先：${primary}`, {
    actor: p.id,
    audience: "dev",
    data: {
      primary,
      impossible,
      viableEvent,
      score: selected.key,
      action: selected.c.action.type,
    },
  });
  return selected.c.action;
}
