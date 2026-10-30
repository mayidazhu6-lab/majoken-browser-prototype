import type { Action, GameState, Setup, Stat } from "./types";
import { createGame, dispatch } from "./reducer";
import { EVENTS, eventProgress, donationItems } from "./events";
import {
  available,
  canRecipe,
  isMaterial,
  materialIds,
  RECIPES,
} from "./items";
import { RESEARCH, STATS } from "./config";
export function simulationAction(s: GameState): Action {
  const p = s.players[0];
  if (s.challenge) return { type: "challengeReply", player: 0, fight: true };
  if (p.pendingRecipe)
    return {
      type: "unlock",
      player: 0,
      recipe: RECIPES.find(
        (r) => r.tier === "special" && !p.recipes.includes(r.id),
      )!.id,
    };
  if (s.combat) {
    const c = s.combat;
    if (c.done) return { type: "reward", player: 0, kind: "item" };
    const side = c.participants.indexOf(0);
    return {
      type: "round",
      player: 0,
      stance:
        c.previous[side] === "charge"
          ? "attack"
          : c.rounds.length % 3 === 0
            ? "charge"
            : "attack",
    };
  }
  if (s.phase === "public") {
    if (p.commands.length) return { type: "forced", player: 0, kind: "gather" };
    const t = s.trades.find((t) => t.to === 0);
    if (t) return { type: "tradeReply", player: 0, id: t.id, accept: true };
    const e = EVENTS[s.event.id - 1];
    const pr = eventProgress(s);
    const ids = donationItems(s, p);
    const stats: Partial<Record<Stat, number>> = {};
    let need = (e.stats ?? 0) - pr.stats;
    if (
      e.stats &&
      (!e.either || pr.materials + ids.length < (e.materials ?? 0))
    )
      for (const k of STATS) {
        const locked = s.event.reservations
          .filter((r) => r.player === 0)
          .reduce((n, r) => n + (r.stats[k] ?? 0), 0);
        const n = Math.min(need, p.stats[k] - locked - 1);
        if (n > 0) {
          stats[k] = n;
          need -= n;
        }
      }
    if (ids.length || Object.keys(stats).length)
      return { type: "reserve", player: 0, items: ids, stats };
    if (
      s.players.some(
        (p) => p.ai && p.ap > 0 && !s.trades.some((t) => t.from === p.id),
      )
    )
      return { type: "aiPublic" };
    if (p.ap) {
      const research = STATS.find((k) => materialIds(p, RESEARCH[k]));
      const r = RECIPES.find(
        (r) => canRecipe(p, r.id, s.day) && materialIds(p, r.materials),
      );
      if (e.potions && r && !pr.success)
        return { type: "brew", player: 0, recipe: r.id };
      if (research && (e.actions?.includes("research") || s.day > 3))
        return { type: "research", player: 0, stat: research };
      return { type: "gather", player: 0 };
    }
    return { type: "advance" };
  }
  if (s.phase === "night" && !p.night)
    return { type: "night", player: 0, choice: { kind: "rest" } };
  return { type: "advance" };
}
export function simulate(seed: string) {
  const setup: Setup = {
    name: "試験魔女",
    seed,
    magic: "barrier",
    stats: { attack: 3, defense: 4, insight: 3 },
  };
  let s = createGame(setup);
  let steps = 0;
  while (s.phase !== "ended" && steps++ < 1500)
    s = dispatch(s, simulationAction(s));
  if (s.phase !== "ended") throw Error(`${seed} did not terminate`);
  return s;
}
