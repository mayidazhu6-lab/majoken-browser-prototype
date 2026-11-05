import type { Combat, GameState, Item, Player, Stance } from "./types";
import { CONFIG, hasElementCombat, level } from "./config";
import { recipe } from "./items";
import { pick } from "./rng";
import { log } from "./core";
import { ELEMENT_HP } from "./elementCombat";
export const STANCES: Stance[] = ["attack", "defend", "charge"];
/** Ownership is unrestricted; only eligible, unlocked items enter combat. */
export function automaticLoadout(p: Player) {
  if (level(p.stats.insight) < 3) return [];
  return p.inventory
    .filter((i) => !i.lock && recipe(i.kind)?.tier === "combat")
    .slice(0, level(p.stats.insight))
    .map((i) => i.id);
}
export function legalStances(c: Combat, side: number): Stance[] {
  return STANCES.filter(
    (v) =>
      v !== "charge" ||
      (c.previous[side] !== "charge" && c.rounds.length < CONFIG.maxRounds - 1),
  );
}
export function startCombat(
  s: GameState,
  a: number,
  b: number,
  kind: Combat["kind"],
) {
  if (a === b) throw Error("自身とは戦えません");
  const c: Combat = {
    id: s.nextCombat++,
    participants: [a, b],
    kind,
    hp: [CONFIG.hp, CONFIG.hp],
    charge: [0, 0],
    previous: [null, null],
    brought: [[], []],
    rounds: [],
    done: false,
    resultAcknowledged: false,
    returnPhase: s.phase,
    illusionRound:
      kind === "secret" &&
      s.players[a].activeMagic &&
      s.players[a].magic === "illusion"
        ? pick(s, [0, 1, 2, 3, 4], "幻惑ラウンド")
        : -1,
    initiator: a,
  };
  if (hasElementCombat(s) && kind !== "secret") {
    c.hp = [ELEMENT_HP, ELEMENT_HP];
    c.elemental = { ready: [kind === "mock", kind === "mock"], rounds: [] };
  }
  s.combat = c;
  log(
    s,
    "combatStart",
    kind === "secret"
      ? "秘匿決闘が始まりました"
      : `${s.players[a].name} vs ${s.players[b].name}${kind === "mock" ? "（模擬戦）" : ""}`,
    { actor: a, target: b, audience: kind === "secret" ? [a, b] : "public" },
  );
  return c;
}
export function loadout(s: GameState, p: Player, ids: number[]) {
  const c = s.combat!;
  const side = c.participants.indexOf(p.id);
  if (side < 0 || c.rounds.length || c.done) throw Error("持込の変更不可");
  if (new Set(ids).size !== ids.length || ids.length > level(p.stats.insight))
    throw Error("持込上限です");
  if (c.brought[side].length) throw Error("持込確定済み");
  const items = ids.map((id) => {
    const item = p.inventory.find((i) => i.id === id && !i.lock);
    if (
      !item ||
      recipe(item.kind)?.tier !== "combat" ||
      level(p.stats.insight) < 3
    )
      throw Error("Lv3戦闘薬のみ持込可");
    return item;
  });
  p.inventory = p.inventory.filter((i) => !ids.includes(i.id));
  c.brought[side] = items;
}
export function damage(diff: number) {
  return diff <= 0 ? 0 : diff <= 2 ? 1 : diff;
}
export function calculateRound(
  stats: [Player["stats"], Player["stats"]],
  choices: [Stance, Stance],
  rolls: [number, number],
  charge: [number, number],
  buffs: [
    { attack: number; defense: number; charge: number },
    { attack: number; defense: number; charge: number },
  ],
  guard: [number, number] = [0, 0],
) {
  const values = choices.map((c, i) =>
    c === "charge"
      ? stats[i].insight + rolls[i] + buffs[i].charge
      : stats[i][c === "attack" ? "attack" : "defense"] +
        rolls[i] +
        charge[i] +
        (c === "attack" ? buffs[i].attack : buffs[i].defense) +
        (c === "defend" ? guard[i] : 0),
  ) as [number, number];
  const hits: [number, number] = [0, 0];
  if (choices[0] === "attack" && choices[1] === "attack") {
    hits[0] = Math.max(1, Math.floor(values[1] / 3));
    hits[1] = Math.max(1, Math.floor(values[0] / 3));
  } else
    for (const i of [0, 1]) {
      const j = 1 - i;
      if (choices[i] !== "attack") continue;
      const diff = values[i] - values[j];
      if (choices[j] === "defend") {
        if (diff < 0) hits[i] = damage(-diff);
      } else hits[j] = Math.max(1, values[i] - 3);
    }
  const next = choices.map((c, i) =>
    c === "charge" ? stats[i].insight + rolls[i] + buffs[i].charge : 0,
  ) as [number, number];
  return { values, damage: hits, charge: next };
}
export function resolveRound(
  s: GameState,
  choices: [Stance, Stance],
  potionIds: [number | undefined, number | undefined],
) {
  const c = s.combat!;
  if (!c || c.done) throw Error("戦闘がありません");
  const original = [...choices] as [Stance, Stance];
  const ps = c.participants.map((id) => s.players[id]) as [Player, Player];
  const potions: (string | null)[] = [null, null];
  const buffs = ps.map(() => ({ attack: 0, defense: 0, charge: 0 })) as [
    { attack: number; defense: number; charge: number },
    { attack: number; defense: number; charge: number },
  ];
  if ([0, 1].some((i) => !legalStances(c, i).includes(choices[i])))
    throw Error("連続ためる・最終ラウンドのためるは不可");
  for (const i of [0, 1]) {
    const id = potionIds[i];
    if (id !== undefined) {
      const item = c.brought[i].find((v) => v.id === id);
      const r = item && recipe(item.kind);
      if (!r || r.tier !== "combat") throw Error("持込薬がありません");
      potions[i] = r.id;
      buffs[i][r.effect as "attack" | "defense" | "charge"] = r.power;
      c.brought[i] = c.brought[i].filter((v) => v.id !== id);
      log(s, "usePotion", `${r.name}を使用`, {
        actor: ps[i].id,
        kind: r.id,
        audience: [ps[i].id],
      });
    }
  }
  if (c.illusionRound === c.rounds.length)
    choices[1] = pick(
      s,
      legalStances(c, 1).filter((v) => v !== choices[1]),
      "幻惑による変更",
    );
  const rolls: [number, number] = [
    pick(s, [1, 2, 3, 4, 5, 6], "1D6"),
    pick(s, [1, 2, 3, 4, 5, 6], "1D6"),
  ];
  const guards = ps.map((p, i) =>
    c.kind === "secret" && c.rounds.length === 0 && p.night?.kind === "guard"
      ? level(p.stats.defense) +
        Number(
          s.logs.find(
            (l) =>
              l.day === s.day && l.actor === p.id && l.type === "guardBuff",
          )?.amount ?? 0,
        )
      : 0,
  ) as [number, number];
  const chargeBonus = [...c.charge] as [number, number];
  const r = calculateRound(
    [ps[0].stats, ps[1].stats],
    choices,
    rolls,
    c.charge,
    buffs,
    guards,
  );
  if (c.rounds.length + 1 >= CONFIG.maxRounds) r.charge = [0, 0];
  c.hp = [
    Math.max(0, c.hp[0] - r.damage[0]),
    Math.max(0, c.hp[1] - r.damage[1]),
  ];
  c.charge = r.charge;
  c.previous = [...choices];
  c.rounds.push({
    insight: [ps[0].stats.insight, ps[1].stats.insight],
    nextCharge: [...r.charge],
    base: choices.map(
      (v, i) =>
        ps[i].stats[
          v === "attack" ? "attack" : v === "charge" ? "insight" : "defense"
        ],
    ) as [number, number],
    chargeBonus: choices.map((v, i) =>
      v === "charge" ? 0 : chargeBonus[i],
    ) as [number, number],
    buffs,
    guard: choices.map((v, i) => (v === "defend" ? guards[i] : 0)) as [
      number,
      number,
    ],
    counter: [
      choices[0] === "defend" && r.damage[1] > 0,
      choices[1] === "defend" && r.damage[0] > 0,
    ],
    choices,
    original,
    rolls,
    values: r.values,
    damage: r.damage,
    hp: [...c.hp],
    potions: potions as [string | null, string | null],
  });
  log(
    s,
    "combatRound",
    `R${c.rounds.length}：${choices.map((v) => (v === "attack" ? "攻撃" : v === "defend" ? "防御" : "ためる")).join(" / ")} · 判定 ${r.values.join("/")} · 被ダメージ ${r.damage.join("/")} · 残HP ${c.hp.join("/")}`,
    {
      actor: c.participants[0],
      target: c.participants[1],
      audience: c.kind === "secret" ? [...c.participants] : "public",
      data: {
        combat: c.id,
        round: structuredClone(c.rounds[c.rounds.length - 1]),
      },
    },
  );
  if (c.hp.some((h) => h <= 0) || c.rounds.length >= CONFIG.maxRounds) {
    c.done = true;
    c.winner =
      c.hp[0] === c.hp[1] ? null : c.participants[c.hp[0] > c.hp[1] ? 0 : 1];
    c.brought = [[], []];
  }
  return c;
}
// 公開能力＋本人の現在戦闘情報だけを受け取る1手先の期待値比較。
export function chooseStance(
  own: Player["stats"],
  opponent: Player["stats"],
  ownCharge: number,
  opponentCharge: number,
  previous: Stance | null,
  hp: [number, number],
  potions: string[] = [],
  remainingRounds = CONFIG.maxRounds as number,
): Stance {
  let best: Stance = "defend",
    bestValue = -Infinity;
  for (const a of ["defend", "attack", "charge"] as Stance[]) {
    if (a === "charge" && (previous === "charge" || remainingRounds <= 1))
      continue;
    let score = 0;
    const buff = { attack: 0, defense: 0, charge: 0 };
    const effect =
      a === "attack" ? "attack" : a === "defend" ? "defense" : "charge";
    const potion = potions.map(recipe).find((r) => r?.effect === effect);
    if (potion) buff[effect] = potion.power;
    for (const b of STANCES)
      for (let d = 1; d <= 6; d++)
        for (let e = 1; e <= 6; e++) {
          const r = calculateRound(
            [own, opponent],
            [a, b],
            [d, e],
            [ownCharge, opponentCharge],
            [buff, { attack: 0, defense: 0, charge: 0 }],
          );
          score +=
            Math.min(hp[1], r.damage[1]) -
            Math.min(hp[0], r.damage[0]) +
            (a === "charge" ? r.charge[0] * 0.3 : 0);
        }
    if (score > bestValue) {
      bestValue = score;
      best = a;
    }
  }
  return best;
}

export function chooseCombatPotion(items: Item[], stance: Stance) {
  const effect =
    stance === "attack" ? "attack" : stance === "defend" ? "defense" : "charge";
  return items.find((i) => recipe(i.kind)?.effect === effect)?.id;
}
