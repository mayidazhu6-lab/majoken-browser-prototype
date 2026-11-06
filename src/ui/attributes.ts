import {
  hasElementCombat,
  hasNightRules,
  level,
  levelEffect,
} from "../domain/config";
import { NIGHT_RECIPES } from "../domain/night";
import type { GameState, Stat } from "../domain/types";

const tiers = ["通常薬", "上位薬", "最上位薬"];

function recipeTiers(recipes: readonly string[]) {
  return tiers
    .filter((_, index) =>
      NIGHT_RECIPES.some(
        (recipe) => recipe.level === index + 1 && recipes.includes(recipe.id),
      ),
    )
    .join("・");
}

export function attributeEffects(
  game: Pick<GameState, "rulesVersion">,
  stat: Stat,
  lv: number,
  recipes: readonly string[],
) {
  const effects = hasElementCombat(game)
    ? [`選んだ属性の戦闘ダメージ ＋${lv - 1}`]
    : [];
  if (!hasNightRules(game)) return [...effects, levelEffect(stat, lv)];

  if (stat === "insight") {
    const unlocked = recipeTiers(recipes);
    return [
      ...effects,
      `解放済みレシピ：${unlocked || "なし"}（解放後はLvが下がっても維持）`,
    ];
  }

  const fire = stat === "attack";
  const ap = lv === 1 ? "1AP目" : "1・2AP目";
  const effect = fire
    ? "採集 −1個、研究の必要素材 ＋1個"
    : "採集 ＋1個、研究の必要素材 −1個";
  const shop = lv === 3 ? `、購買部の必要素材 ${fire ? "＋" : "−"}1個` : "";
  return [
    ...effects,
    `${fire ? "襲撃" : "警戒"}ボーナス ＋${lv - 1}（対象の戦闘ごとに1回）`,
    `${fire ? "呪詛が命中した相手" : "休息に成功した自分"}の翌日${ap}：${effect}${shop}`,
  ];
}

export function attributeGains(
  game: Pick<GameState, "rulesVersion">,
  stat: Stat,
  before: number,
  after: number,
  recipes: readonly string[],
) {
  const increase = after - before;
  if (increase <= 0) return [];

  const effects = hasElementCombat(game)
    ? [`戦闘ダメージのLv補正がさらに ＋${increase}`]
    : [];
  if (!hasNightRules(game)) return [...effects, levelEffect(stat, after)];

  if (stat === "insight") {
    const newlyUnlocked = NIGHT_RECIPES.filter(
      (recipe) => recipe.level <= after && !recipes.includes(recipe.id),
    );
    return [
      ...effects,
      newlyUnlocked.length
        ? `${recipeTiers(newlyUnlocked.map((recipe) => recipe.id))}のレシピ解放（${newlyUnlocked.map((recipe) => recipe.name).join("・")}）`
        : "このLvで使えるレシピはすでに解放済み",
    ];
  }

  const fire = stat === "attack";
  const action = fire ? "呪詛" : "休息";
  effects.push(`${fire ? "襲撃" : "警戒"}ボーナスがさらに ＋${increase}`);
  if (before === 1)
    effects.push(`${action}による採集・研究の補正が翌日の2AP目にも適用`);
  if (after === 3)
    effects.push(
      `${action}で翌日の購買部の必要素材 ${fire ? "＋" : "−"}1個（1・2AP目）`,
    );
  return effects;
}

export function researchOutcome(
  game: Pick<GameState, "rulesVersion">,
  stat: Stat,
  value: number,
  growth: number,
  recipes: readonly string[],
) {
  const after = value + growth;
  const beforeLevel = level(value);
  const afterLevel = level(after);
  return {
    after,
    beforeLevel,
    afterLevel,
    gains: attributeGains(game, stat, beforeLevel, afterLevel, recipes),
  };
}
