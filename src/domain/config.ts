import type { Magic, Stat } from "./types";
export const CONFIG = {
  rulesVersion: "browser-0.2.1+decisions-3",
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
  ho: "HO判定",
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
  defense: ["herb", "crystal"],
  insight: ["obsidian", "herb"],
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
