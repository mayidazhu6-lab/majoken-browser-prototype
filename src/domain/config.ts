import type { Magic, Stat } from "./types";
export const LEGACY_RULES_VERSION = "browser-0.2.2+decisions-5";
export const V20_PUBLIC_RULES_VERSION = "browser-2.0-public";
export const V20_COMBAT_RULES_VERSION = "browser-2.0-combat";
export const V20_NIGHT_RULES_VERSION = "browser-2.0-night";
export const V20_GOALS_RULES_VERSION = "browser-2.0-goals";
export const V20_STRATEGY_RULES_VERSION = "browser-2.0-strategy";
export const V20_REVIEW_RULES_VERSION = "browser-2.0-review";
export const V20_RELEASE_RULES_VERSION = "browser-2.0";
export const V20_PLAYTEST_RULES_VERSION = "browser-2.0.1";
export const V20_PREVIOUS_RULES_VERSION = "browser-2.0.2";
export const V20_NPC_RULES_VERSION = "browser-2.0.3";
export const V20_RULES_VERSION = "browser-2.0.4";
export const hasRandomElementAI = (s: { rulesVersion: string }) =>
  s.rulesVersion === V20_RULES_VERSION ||
  s.rulesVersion === V20_NPC_RULES_VERSION;
export const hasRevisedNightRules = (s: { rulesVersion: string }) =>
  hasRandomElementAI(s) || s.rulesVersion === V20_PREVIOUS_RULES_VERSION;
export const hasPlaytestRules = (s: { rulesVersion: string }) =>
  hasRevisedNightRules(s) || s.rulesVersion === V20_PLAYTEST_RULES_VERSION;
export const hasGoalDrivenRewards = (s: { rulesVersion: string }) =>
  hasPlaytestRules(s) || s.rulesVersion === V20_RELEASE_RULES_VERSION;
export const hasSharedCrisisPlanning = (s: { rulesVersion: string }) =>
  hasGoalDrivenRewards(s) || s.rulesVersion === V20_REVIEW_RULES_VERSION;
export const hasStrategyRules = (s: { rulesVersion: string }) =>
  hasSharedCrisisPlanning(s) || s.rulesVersion === V20_STRATEGY_RULES_VERSION;
export const hasFinalGoalRules = (s: { rulesVersion: string }) =>
  hasStrategyRules(s) || s.rulesVersion === V20_GOALS_RULES_VERSION;
export const hasNightRules = (s: { rulesVersion: string }) =>
  hasFinalGoalRules(s) || s.rulesVersion === V20_NIGHT_RULES_VERSION;
export const hasElementCombat = (s: { rulesVersion: string }) =>
  hasNightRules(s) || s.rulesVersion === V20_COMBAT_RULES_VERSION;
export const isV20 = (s: { rulesVersion: string }) =>
  hasElementCombat(s) || s.rulesVersion === V20_PUBLIC_RULES_VERSION;
export const V20_MAGICS = ["foresight", "barrier"] as const;
export const V20_LABELS: Record<string, string> = {
  attack: "火",
  defense: "水",
  insight: "風",
  dew: "人魚の涙",
};
export const CONFIG = {
  rulesVersion: "browser-0.2.3+decisions-6",
  days: 8,
  ap: 2,
  collapse: 3,
  hp: 20,
  maxRounds: 5,
  level2: 6,
  level3: 9,
  thresholds: [5, 10],
  rest: [1, 2, 3],
  curse: [1, 2, 3],
  combatBuff: 4,
  aiCooperation: 8,
  aiCrisisCooperation: 20,
} as const;
export const MATERIALS = [
  "obsidian",
  "crystal",
  "herb",
  "sand",
  "water",
  "dew",
];
export const LABELS: Record<string, string> = {
  obsidian: "黒曜石",
  crystal: "魔力結晶",
  herb: "月光草",
  sand: "星の砂",
  water: "精霊水",
  dew: "夜露石",
  attack: "攻撃",
  defense: "防御",
  insight: "洞察",
  raid: "襲撃",
  curse: "呪詛",
  guard: "警戒",
  rest: "休息",
  brew: "錬金",
  scout: "偵察",
  defend: "防御",
  charge: "ためる",
  public: "公開行動",
  magic: "固有魔法",
  vote: "予知投票",
  night: "秘匿行動",
  duels: "秘匿決闘",
  rewards: "戦利品",
  results: "夜結果",
  ho: "課題判定",
  dawn: "夜明け",
  ended: "研究終了",
};
export const STATS: Stat[] = ["attack", "defense", "insight"];
export const MAGICS: Record<
  Magic,
  { name: string; cd: number; description: string }
> = {
  foresight: {
    name: "予知",
    cd: 3,
    description: "翌日の候補3枚を見て匿名投票。第1〜7日。",
  },
  illusion: {
    name: "幻惑",
    cd: 2,
    description: "自分の襲撃決闘で相手の手を1ラウンド変更。",
  },
  barrier: {
    name: "結界",
    cd: 3,
    description: "自分または1人への今夜の干渉を遮断。",
  },
  shadow: {
    name: "影渡り",
    cd: 2,
    description: "偵察の確認数+2。呪詛にもFP減点。",
  },
  alchemy: {
    name: "秘伝錬成",
    cd: 2,
    description: "未解放の特殊レシピ1種を翌日の夜錬金まで使用。第1〜7日。",
  },
};
export const RESEARCH: Record<Stat, string[]> = {
  attack: ["obsidian", "crystal"],
  defense: ["herb", "sand"],
  insight: ["water", "dew"],
};
export const V20_RESEARCH: Record<Stat, string[]> = {
  attack: RESEARCH.attack,
  defense: ["herb", "dew"],
  insight: ["water", "sand"],
};
export function level(value: number) {
  return value >= CONFIG.level3 ? 3 : value >= CONFIG.level2 ? 2 : 1;
}
export function nextLevel(value: number) {
  return value < CONFIG.level2
    ? CONFIG.level2
    : value < CONFIG.level3
      ? CONFIG.level3
      : null;
}
export function levelEffect(stat: Stat, lv: number) {
  if (stat === "attack") return `呪詛の減衰量 ${CONFIG.curse[lv - 1]}`;
  if (stat === "defense")
    return `警戒の初R防御補正 +${lv}、休息成功時の翌日採集・研究 +${CONFIG.rest[lv - 1]}`;
  return `戦闘薬持込枠 ${lv}個${lv === 3 ? "。Lv3戦闘薬の作成・持込を解禁" : "（現在の戦闘薬はLv3で解禁）"}`;
}

export const supportedRulesVersion = (version: string) =>
  version === CONFIG.rulesVersion ||
  version === LEGACY_RULES_VERSION ||
  version === V20_RULES_VERSION ||
  version === V20_NPC_RULES_VERSION ||
  version === V20_PREVIOUS_RULES_VERSION ||
  version === V20_RELEASE_RULES_VERSION ||
  version === V20_PLAYTEST_RULES_VERSION ||
  version === V20_REVIEW_RULES_VERSION ||
  version === V20_STRATEGY_RULES_VERSION ||
  version === V20_GOALS_RULES_VERSION ||
  version === V20_NIGHT_RULES_VERSION ||
  version === V20_COMBAT_RULES_VERSION ||
  version === V20_PUBLIC_RULES_VERSION;
