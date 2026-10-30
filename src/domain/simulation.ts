import type { Action, GameState, Setup, Stat } from "./types";
import { createGame, dispatch, currentPlayer } from "./reducer";
import {
  EVENTS,
  eventProgress,
  donationItems,
  reservationRoom,
} from "./events";
import { canRecipe, materialIds, RECIPES } from "./items";
import { RESEARCH, STATS } from "./config";
export function simulationAction(s: GameState): Action {
  const p = s.players[0];
  if (s.event.resolved && !s.event.acknowledged)
    return { type: "eventAck", player: 0 };
  if (s.publicOutcome) return { type: "publicOutcomeAck", player: 0 };
  if (s.challenge) return { type: "challengeReply", player: 0, fight: true };
  if (s.combat) {
    const c = s.combat;
    if (c.done)
      return (c.kind === "public" || c.kind === "secret") &&
        !c.resultAcknowledged
        ? { type: "combatAck", player: 0 }
        : { type: "reward", player: 0, kind: "item" };
    const side = c.participants.indexOf(0);
    return {
      type: "round",
      player: 0,
      stance:
        c.previous[side] === "charge" || c.rounds.length === 4
          ? "attack"
          : c.rounds.length % 3 === 0
            ? "charge"
            : "attack",
    };
  }
  if (p.pendingRecipe)
    return {
      type: "unlock",
      player: 0,
      recipe: RECIPES.find(
        (r) => r.tier === "special" && !p.recipes.includes(r.id),
      )!.id,
    };
  if (s.phase === "public") {
    const t = s.trades.find((t) => t.to === 0);
    if (t) return { type: "tradeReply", player: 0, id: t.id, accept: true };
    if (s.publicTurn.round === 4) return { type: "advance" };
    if (currentPlayer(s) !== 0) return { type: "aiPublic" };
    if (p.commands.length && !s.publicTurn.acted && s.publicTurn.round <= 2)
      return { type: "forced", player: 0, kind: "gather" };
    const e = EVENTS[s.event.id - 1];
    const pr = eventProgress(s);
    const ids = donationItems(s, p);
    const stats: Partial<Record<Stat, number>> = {};
    let need = Math.min(
      (e.stats ?? 0) - pr.stats,
      Math.max(0, reservationRoom(s, p) - ids.length),
    );
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
    if (p.ap && !s.publicTurn.acted && s.publicTurn.round <= 2) {
      const research = STATS.find((k) => materialIds(p, RESEARCH[k]));

      if (research && (e.actions?.includes("research") || s.day > 3))
        return { type: "research", player: 0, stat: research };
      return { type: "gather", player: 0 };
    }
    return { type: "endTurn", player: 0 };
  }
  if (s.phase === "night" && !p.night) {
    const copy = structuredClone(p);
    const recipes: string[] = [];
    for (const r of RECIPES.filter((r) => r.tier === "normal")) {
      let ids: number[] | null;
      while (
        canRecipe(copy, r.id, s.day) &&
        (ids = materialIds(copy, r.materials))
      ) {
        const consumed = ids;
        copy.inventory = copy.inventory.filter((i) => !consumed.includes(i.id));
        recipes.push(r.id);
      }
    }
    return {
      type: "night",
      player: 0,
      choice: recipes.length ? { kind: "brew", recipes } : { kind: "rest" },
    };
  }
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
