import { hasGoalDrivenRewards, LABELS, level, V20_RESEARCH } from "./config";
import { fp, log } from "./core";
import { ELEMENT_POTIONS } from "./elementCombat";
import { addItem, available, consume, materialIds } from "./items";
import type { GameState, Night, NightBattle, Player, Stat } from "./types";

export const NIGHT_RECIPES = [
  { id: "abundance", name: "豊穣の薬", materials: ["herb", "herb"], level: 1 },
  {
    id: "scholarship",
    name: "研鑽の薬",
    materials: ["obsidian", "obsidian"],
    level: 1,
  },
  {
    id: "bargaining",
    name: "交渉の薬",
    materials: ["water", "water"],
    level: 1,
  },
  ...Object.values(ELEMENT_POTIONS).map((potion) => ({ ...potion, level: 2 })),
  {
    id: "purification",
    name: "浄化の薬",
    materials: ["obsidian", "crystal"],
    level: 3,
  },
  {
    id: "invisibility",
    name: "透明の薬",
    materials: ["water", "dew"],
    level: 3,
  },
  { id: "might", name: "剛力の薬", materials: ["herb", "sand"], level: 3 },
];
export const NIGHT_RECIPE_EFFECTS: Record<string, string> = {
  abundance: "使用した日の公開採集で獲得素材＋1個。",
  scholarship: "使用した日の公開研究で能力の成長＋1。",
  bargaining: "使用した日の購買部の交換で必要素材−1個。",
  flame: "火を選んだラウンドの与ダメージ＋1。",
  ice: "水を選んだラウンドの与ダメージ＋1。",
  tornado: "風を選んだラウンドの与ダメージ＋1。",
  purification: "呪詛を受けたとき、自動で1個消費してその呪詛を無効化。",
  invisibility:
    "偵察を受けたとき、自動で1個消費して偵察とそれによる戦闘を阻止。",
  might:
    "相手の警戒補正が＋1以上の戦闘で、自動で1個消費してその戦闘の警戒補正を無効化。",
};
export const nightRecipe = (id: string) =>
  NIGHT_RECIPES.find((r) => r.id === id);
export const usable = (s: GameState, p: Player) =>
  available(p).filter((i) => (i.usableDay ?? 0) <= s.day);

export function unlockNightRecipes(p: Player) {
  for (const r of NIGHT_RECIPES)
    if (r.level <= level(p.stats.insight) && !p.recipes.includes(r.id))
      p.recipes.push(r.id);
}

function brewPlan(p: Player, plan: string[], apply: (id: string) => void) {
  for (const id of plan) {
    const r = nightRecipe(id);
    if (!r || !p.recipes.includes(id)) throw Error("未解放のレシピです");
    const materials = materialIds(p, r.materials);
    if (!materials) throw Error("錬金に必要な素材が足りません");
    consume(p, materials);
    apply(id);
  }
}

export function chooseNight(s: GameState, p: Player, choice: Night) {
  if (s.phase !== "night" || p.night) throw Error("夜間行動は確定済みです");
  const { kind, target } = choice;
  if (!["raid", "scout", "curse", "guard", "rest"].includes(kind))
    throw Error("夜間行動が不正です");
  if (
    ["raid", "scout", "curse"].includes(kind) &&
    (target === undefined || !s.players[target] || target === p.id)
  )
    throw Error("対象を選んでください");
  if (kind === "raid" && p.lastRaid === s.day - 1)
    throw Error("相互襲撃の翌夜は襲撃できません");
  const recipes = [...(choice.recipes ?? [])];
  brewPlan(structuredClone(p), recipes, () => {});
  p.night = { kind, target, recipes };
  log(s, "nightChoice", `${LABELS[kind]}を確定`, {
    actor: p.id,
    kind,
    target,
    audience: [p.id],
  });
}

export function autoPotion(s: GameState, p: Player, kind: string) {
  const item = usable(s, p).find((i) => i.kind === kind);
  if (!item) return false;
  consume(p, [item.id]);
  log(s, "usePotion", `${nightRecipe(kind)!.name}が発動`, {
    actor: p.id,
    kind,
    audience: [p.id],
  });
  return true;
}

export function registerNight(s: GameState) {
  const order = s.publicTurn.order;
  for (const id of order) {
    const p = s.players[id];
    if (!p.night) chooseNight(s, p, { kind: "rest" });
    brewPlan(p, p.night!.recipes ?? [], (kind) => {
      addItem(s, p, kind).usableDay = s.day + 1;
      log(s, "brew", `${nightRecipe(kind)!.name}を作成`, {
        actor: id,
        kind,
        audience: [id],
      });
      log(s, "acquirePotion", "完成薬を獲得", {
        actor: id,
        kind,
        audience: [id],
      });
    });
  }
  const valid = order.filter((id) => {
    const { kind, target } = s.players[id].night!;
    if (target === undefined || !["raid", "scout", "curse"].includes(kind))
      return false;
    const p = s.players[target];
    const blocked =
      s.barriers.includes(target) ||
      (kind === "scout" && autoPotion(s, p, "invisibility")) ||
      (kind === "curse" && autoPotion(s, p, "purification"));
    if (blocked)
      log(
        s,
        kind === "scout" ? "scoutBlocked" : kind + "Blocked",
        kind === "scout"
          ? `${p.name}の夜間行動を取得できなかった`
          : "行動は成立しませんでした",
        { actor: id, target, audience: [id] },
      );
    return !blocked;
  });
  const battles: NightBattle[] = [];
  const registered = new Set<number>();
  for (const id of valid) {
    if (registered.has(id)) continue;
    const { kind, target: to } = s.players[id].night!;
    const target = to!;
    const opposite = s.players[target].night!;
    const mutual = valid.includes(target) && opposite.target === id;
    if (
      mutual &&
      ((kind === "raid" && ["raid", "scout"].includes(opposite.kind)) ||
        (kind === "scout" && opposite.kind === "raid"))
    ) {
      const raids = [id, target].filter(
        (actor) => s.players[actor].night!.kind === "raid",
      );
      const scout =
        raids.length === 1 ? (kind === "scout" ? id : target) : undefined;
      battles.push({ participants: [id, target], raids, scout });
      registered.add(target);
      if (raids.length === 2)
        for (const actor of raids) s.players[actor].lastRaid = s.day;
    } else if (kind === "raid") {
      const automatic = opposite.kind === "rest";
      battles.push({
        participants: [id, target],
        raids: [id],
        automatic,
        ...(automatic ? { winner: id } : {}),
      });
      if (automatic)
        for (const actor of [id, target])
          log(s, "automaticBattle", "休息中の襲撃は自動決着", {
            actor,
            audience: [actor],
          });
    } else if (kind === "scout" && opposite.kind === "guard") {
      battles.push({ participants: [id, target], raids: [], scout: id });
    }
  }
  s.nightWork = { battles, valid, battle: 0, reward: 0 };
  s.phase = "duels";
}

export function rewardOptions(s: GameState) {
  const work = s.nightWork;
  const battle = work?.battles[work.reward];
  if (!battle?.raids.length || battle.winner == null) return undefined;
  const loser =
    s.players[battle.participants.find((id) => id !== battle.winner)!];
  return {
    battle,
    winner: battle.winner,
    loser,
    items: available(loser),
    canCommand: s.day < 8 && loser.commands.length < 2,
  };
}

export function giveNightReward(
  s: GameState,
  player: number,
  item?: number,
  command?: "gather" | "research",
) {
  const options = rewardOptions(s);
  if (
    s.phase !== "rewards" ||
    !options ||
    player !== options.winner ||
    (item === undefined) === (command === undefined)
  )
    throw Error("報酬を選択できません");
  const { battle, loser, items, canCommand } = options;
  const winner = s.players[player];
  const audience = [player, loser.id];
  const data = { initiated: battle.raids.includes(player) };
  if (item !== undefined) {
    const selected = items.find((i) => i.id === item);
    if (!selected) throw Error("その品は強奪できません");
    consume(loser, [item]);
    winner.inventory.push(selected);
    log(
      s,
      "loot",
      `強奪：${nightRecipe(selected.kind)?.name ?? LABELS[selected.kind]}`,
      {
        actor: player,
        target: loser.id,
        amount: 1,
        kind: selected.kind,
        data,
        audience,
      },
    );
    log(s, "receive", "強奪で品を獲得", {
      actor: player,
      target: loser.id,
      amount: 1,
      kind: "loot",
      audience,
    });
    if (nightRecipe(selected.kind))
      log(s, "acquirePotion", "完成薬を獲得", {
        actor: player,
        kind: selected.kind,
        audience: [player],
      });
  } else {
    if (!canCommand || (command !== "gather" && command !== "research"))
      throw Error("行動命令を出せません");
    loser.commands.push({
      from: player,
      kind: command,
      qualifies: !battle.automatic && data.initiated,
    });
    log(s, "command", `翌日の${command === "gather" ? "採集" : "研究"}を命令`, {
      actor: player,
      target: loser.id,
      data: hasGoalDrivenRewards(s)
        ? { ...data, qualifies: !battle.automatic && data.initiated }
        : data,
      audience,
    });
  }
  s.nightWork!.reward++;
}

export function finishNight(s: GameState) {
  const { battles, valid } = s.nightWork!;
  const deductions = new Map<number, number>();
  for (const id of s.publicTurn.order) {
    const p = s.players[id];
    const { kind, target } = p.night!;
    if (kind === "guard")
      log(s, "guard", "警戒を実行", { actor: id, audience: [id] });
    if (
      kind === "rest" &&
      !battles.some((b) => b.automatic && b.participants[1] === id)
    ) {
      if (s.day < 8) p.rest = level(p.stats.defense);
      log(s, "rest", "休息成功", { actor: id, amount: 1, audience: [id] });
    }
    if (!valid.includes(id) || target === undefined) continue;
    const other = s.players[target];
    if (kind === "curse") {
      if (s.day < 8) other.curse = Math.max(other.curse, level(p.stats.attack));
      log(s, "curseHit", "呪詛が命中", { actor: id, target, audience: [id] });
      log(s, "cursed", "呪詛を受けました", {
        actor: target,
        audience: [target],
      });
    } else if (kind === "scout") {
      const battle = battles.find((b) => b.scout === id);
      if (battle && battle.winner !== id) {
        log(s, "scoutBlocked", `${other.name}の夜間行動を取得できなかった`, {
          actor: id,
          target,
          audience: [id],
        });
        continue;
      }
      log(s, "scout", `${other.name}の夜間行動：${LABELS[other.night!.kind]}`, {
        actor: id,
        target,
        amount: 1,
        audience: [id],
      });
      if (battle)
        deductions.set(target, Math.min(3, (deductions.get(target) ?? 0) + 1));
    }
  }
  for (const [id, count] of deductions) fp(s, s.players[id], -count, "scout");
  s.phase = "ho";
}

export function publicModifiers(p: Player) {
  const rest = p.rest >= (p.ap === 2 ? 1 : 2);
  const curse = p.curse >= (p.ap === 2 ? 1 : 2);
  return {
    gather: Number(rest) - Number(curse),
    research: Number(curse) - Number(rest),
    shop:
      Number(p.curse === 3) -
      Number(p.rest === 3) -
      Number(!!p.publicPotions?.includes("bargaining")),
  };
}

export function publicResearchCost(
  p: Player,
  stat: Stat,
  material?: string,
): readonly string[] | null {
  const base = V20_RESEARCH[stat];
  const adjustment = publicModifiers(p).research;
  if (!adjustment) return base;
  if (!material || !base.includes(material)) return null;
  return adjustment > 0 ? [...base, material] : [material];
}

export const publicResearchGrowth = (p: Player) =>
  1 + Number(!!p.publicPotions?.includes("scholarship"));
