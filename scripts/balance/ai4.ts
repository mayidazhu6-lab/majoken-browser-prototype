import { createHash } from "node:crypto";
import { createGame, dispatch } from "../../src/domain/reducer";
import type { Action, GameState } from "../../src/domain/types";

export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Test-only seat override; never persisted or imported by the product. */
export function initialState(seed: string, version: string) {
  const s = createGame(
    {
      name: "検証AI",
      seed,
      magic: "barrier",
      stats: { attack: 3, defense: 3, insight: 3 },
    },
    version,
  );
  s.players[0].ai = true;
  return s;
}

export function runAI4(seed: string, version: string) {
  let s = initialState(seed, version);
  const initial = digest({
    players: s.players,
    rng: s.rng,
    draws: s.draws,
    event: s.event,
  });
  for (let step = 0; s.phase !== "ended"; step++) {
    if (step >= 300) throw Error(`${seed}: progression limit at ${s.phase}`);
    let action: Action;
    if (s.event.resolved && !s.event.acknowledged)
      action = { type: "eventAck", player: 0 };
    else if (s.publicOutcome) action = { type: "publicOutcomeAck", player: 0 };
    else {
      if (
        s.combat ||
        s.challenge ||
        s.phase === "vote" ||
        s.phase === "rewards"
      )
        throw Error(`${seed}: unexpected AI decision pause ${s.phase}`);
      action = { type: s.phase === "public" ? "aiPublic" : "advance" };
    }
    s = dispatch(s, action);
  }
  return { state: s, initial };
}

export function extract(s: GameState) {
  const fpDays = Array.from({ length: 8 }, (_, i) =>
    s.players.every((p) => p.dailyHistory.some((h) => h.day === i + 1))
      ? s.players.map((p) =>
          s.logs
            .filter(
              (l) => l.type === "fp" && l.actor === p.id && l.day <= i + 1,
            )
            .reduce((n, l) => n + (l.amount ?? 0), 0),
        )
      : null,
  );
  const final = s.players.map((p) => p.fp);
  const reconstructed = s.players.map((p) =>
    s.logs
      .filter((l) => l.type === "fp" && l.actor === p.id)
      .reduce((n, l) => n + (l.amount ?? 0), 0),
  );
  if (digest(final) !== digest(reconstructed))
    throw Error("FP reconstruction mismatch");
  const leaders = (fp: number[]) =>
    fp.flatMap((n, i) => (n === Math.max(...fp) ? [i] : []));
  const day4Leaders = fpDays[3] ? leaders(fpDays[3]) : [];
  const finalLeaders = fpDays[7] ? leaders(final) : [];
  const publicCombats = s.logs.filter(
    (l) => l.type === "combat" && l.data?.kind === "public",
  );
  const duels = [
    ...new Map(
      publicCombats.map((l) => [
        l.data!.id,
        { day: l.day, winner: l.data!.winner },
      ]),
    ).values(),
  ];
  const wins = s.logs
    .filter((l) => l.type === "win" && l.data?.kind === "public")
    .map((l) => ({ day: l.day, player: l.actor! }));
  const publicChoices = s.logs
    .filter((l) => l.type === "aiReason" && l.phase === "public")
    .map((l) => ({ day: l.day, player: l.actor, action: l.data?.action }));
  const events = s.logs
    .filter((l) => l.type === "eventResult")
    .map((l) => ({
      day: l.day,
      event: l.data?.event,
      success: l.data?.success,
    }));
  return {
    seed: s.seed,
    version: s.rulesVersion,
    reason: s.result!.reason,
    day: s.day,
    fpDays,
    final,
    day4Leaders,
    finalLeaders,
    chiefs: s.result!.chiefs,
    ranking: s.result!.ranking,
    longGoals: s.players.map((p) => ({
      id: p.longGoal.id,
      achieved: p.longGoal.achieved,
    })),
    duels,
    wins,
    events,
    publicChoices,
    cooperation: {
      reservations: s.logs.filter((l) => l.type === "reserve").length,
      contributions: s.logs.filter((l) => l.type === "contribution").length,
    },
    trace: digest(s.logs.filter((l) => l.type !== "audit")),
    draws: s.draws,
  };
}
