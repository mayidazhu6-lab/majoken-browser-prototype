import { CONFIG, level, STATS, V20_LABELS } from "./config";
import { log } from "./core";
import { available, consume } from "./items";
import type { Combat, GameState, Player, Stat } from "./types";

export const ELEMENT_HP = 12;
export const ELEMENT_POTIONS = {
  attack: { id: "flame", name: "火炎の薬", materials: ["crystal", "crystal"] },
  defense: { id: "ice", name: "氷結の薬", materials: ["dew", "dew"] },
  insight: { id: "tornado", name: "竜巻の薬", materials: ["sand", "sand"] },
} as const;

export const elementPotion = (kind: string) =>
  Object.values(ELEMENT_POTIONS).find((potion) => potion.id === kind);

const beats: Record<Stat, Stat> = {
  attack: "insight",
  insight: "defense",
  defense: "attack",
};

export function elementDamage(
  value: number,
  own: Stat,
  opponent: Stat,
  potion: boolean,
) {
  const affinity = own === opponent ? 0 : beats[own] === opponent ? 1 : -1;
  const levelBonus = level(value) - 1;
  const potionBonus = Number(potion);
  return {
    affinity,
    levelBonus,
    potionBonus,
    total: Math.max(0, 2 + levelBonus + affinity + potionBonus),
  };
}

export function elementLoadout(s: GameState, p: Player, ids: number[]) {
  const c = s.combat;
  const side = c?.participants.indexOf(p.id);
  if (
    !c?.elemental ||
    c.kind !== "public" ||
    side === undefined ||
    side < 0 ||
    c.done ||
    c.elemental.rounds.length ||
    c.elemental.ready[side]
  )
    throw Error("上位薬の持ち込みを確定できません");
  if (ids.length > 2 || new Set(ids).size !== ids.length)
    throw Error("持ち込みは1戦闘につき最大2個です");
  const items = ids.map((id) => {
    const item = available(p).find((candidate) => candidate.id === id);
    if (!item || !elementPotion(item.kind))
      throw Error("持ち込める上位薬がありません");
    return item;
  });
  consume(p, ids);
  c.brought[side] = items;
  c.elemental.ready[side] = true;
}

export function prepareElementAI(s: GameState, c: Combat) {
  for (const [side, id] of c.participants.entries()) {
    const p = s.players[id];
    if (p.ai && !c.elemental!.ready[side])
      elementLoadout(
        s,
        p,
        available(p)
          .filter((item) => elementPotion(item.kind))
          .slice(0, 2)
          .map((item) => item.id),
      );
  }
}

export function chooseElement(c: Combat, s: GameState, side: number): Stat {
  const own = s.players[c.participants[side]].stats;
  const opponent = s.players[c.participants[1 - side]].stats;
  const score = (element: Stat) =>
    STATS.reduce((total, other) => {
      const dealt = elementDamage(
        own[element],
        element,
        other,
        elementPotionFor(c, side, element) !== undefined,
      );
      const received = elementDamage(opponent[other], other, element, false);
      return (
        total +
        Math.min(c.hp[1 - side], dealt.total) -
        Math.min(c.hp[side], received.total)
      );
    }, 0);
  return STATS.reduce((best, element) =>
    score(element) > score(best) ? element : best,
  );
}

export function elementPotionFor(c: Combat, side: number, element: Stat) {
  return c.brought[side].find(
    (item) => item.kind === ELEMENT_POTIONS[element].id,
  )?.id;
}

export function resolveElementRound(
  s: GameState,
  choices: [Stat, Stat],
  ids: [number | undefined, number | undefined],
) {
  const c = s.combat;
  if (!c?.elemental || c.done || !c.elemental.ready.every(Boolean))
    throw Error("先に持ち込みを確定してください");
  const effects = choices.map((element, side) => {
    if (!STATS.includes(element)) throw Error("属性が不正です");
    const id = ids[side];
    const potion =
      id === undefined
        ? undefined
        : c.brought[side].find((item) => item.id === id);
    if (
      id !== undefined &&
      (c.kind !== "public" || potion?.kind !== ELEMENT_POTIONS[element].id)
    )
      throw Error("選択した属性に対応する上位薬だけ使用できます");
    const { total, ...bonuses } = elementDamage(
      s.players[c.participants[side]].stats[element],
      element,
      choices[1 - side],
      !!potion,
    );
    return {
      element,
      ...bonuses,
      calculated: total,
      dealt: Math.min(c.hp[1 - side], total),
      potion: potion?.kind,
    };
  });
  const [a, b] = effects;
  c.hp = [c.hp[0] - b.dealt, c.hp[1] - a.dealt];
  c.elemental.rounds.push({ sides: [a, b], hp: [...c.hp] });
  for (const [side, effect] of effects.entries()) {
    if (!effect.potion) continue;
    c.brought[side] = c.brought[side].filter((item) => item.id !== ids[side]);
    log(s, "usePotion", `${elementPotion(effect.potion)!.name}を使用`, {
      actor: c.participants[side],
      kind: effect.potion,
    });
  }
  log(
    s,
    "combatRound",
    `${V20_LABELS[a.element]} 対 ${V20_LABELS[b.element]}`,
    { data: { id: c.id } },
  );
  if (c.hp.includes(0) || c.elemental.rounds.length >= CONFIG.maxRounds) {
    c.done = true;
    c.winner =
      c.hp[0] === c.hp[1] ? null : c.participants[c.hp[0] > c.hp[1] ? 0 : 1];
  }
}
