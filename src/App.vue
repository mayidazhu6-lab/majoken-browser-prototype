<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import { combatReason, revealedActions } from "./ui/combatPresentation";
import { plannedMaterials, potionDescription } from "./ui/alchemy";
import TaskBriefing from "./components/TaskBriefing.vue";
import BlockingDialog from "./components/BlockingDialog.vue";
import RuleGuide from "./components/RuleGuide.vue";
import GroupedItems from "./components/GroupedItems.vue";
import QuantitySpinner from "./components/QuantitySpinner.vue";
import AttributeDetails from "./components/AttributeDetails.vue";
import ResearchPreview from "./components/ResearchPreview.vue";
import { ELEMENT_POTIONS, elementPotion } from "./domain/elementCombat";
import {
  NIGHT_RECIPES,
  NIGHT_RECIPE_EFFECTS,
  nightRecipe as modernRecipe,
  publicModifiers,
  publicResearchCost,
  publicResearchGrowth,
  rewardOptions,
  usable,
} from "./domain/night";
import { legalStances } from "./domain/combat";
import TurnStatus from "./components/TurnStatus.vue";
import InstituteHealth from "./components/InstituteHealth.vue";
import EventOverview from "./components/EventOverview.vue";
import GameIcon from "./components/GameIcon.vue";
import { midpointNotice } from "./ui/midpointNotice";
import { schoolTheme } from "./ui/schoolTheme";
import CombatAffinity from "./components/CombatAffinity.vue";
import CombatRounds from "./components/CombatRounds.vue";
import { useGameStore } from "./stores/game";
import {
  CONFIG,
  LABELS as LEGACY_LABELS,
  V20_LABELS,
  V20_MAGICS,
  V20_RESEARCH,
  RESEARCH,
  isV20,
  V20_RULES_VERSION,
  V20_NPC_RULES_VERSION,
  V20_PREVIOUS_RULES_VERSION,
  V20_RELEASE_RULES_VERSION,
  V20_PLAYTEST_RULES_VERSION,
  hasNightRules,
  hasPlaytestRules,
  hasRevisedNightRules,
  hasFinalGoalRules,
  MAGICS,
  MATERIALS,
  STATS,
  level,
  levelEffect,
} from "./domain/config";
import { EVENTS, eventProgress, reservationUnits } from "./domain/events";
import {
  available,
  recipe,
  RECIPES,
  materialIds,
  consume,
  canRecipe,
  isMaterial,
} from "./domain/items";
import {
  goalDescription as describeGoal,
  dailyProgress as describeDailyProgress,
} from "./domain/ho";
import { publicDuelReward } from "./domain/publicDuelReward";
import { graduationProgress } from "./ui/graduationProgress";
import { dailyReview } from "./ui/dailyReview";
import { nightReadiness } from "./ui/nightReadiness";
import { uiText } from "./ui/text";
import { dispatch, currentPlayer } from "./domain/reducer";
import { serialize } from "./domain/persistence";
import type {
  Action,
  Combat,
  Log,
  Magic,
  NightKind,
  Setup,
  Stat,
  Stance,
} from "./domain/types";
function goalDescription(
  goal: Parameters<typeof describeGoal>[0],
  long: boolean,
) {
  const description = describeGoal(
    goal,
    long,
    !!store.state && hasFinalGoalRules(store.state),
  );
  return {
    ...description,
    name: uiText(description.name),
    condition: uiText(description.condition).replace(
      /席(\d+)/g,
      (seat, number) => store.state?.players[Number(number) - 1]?.name ?? seat,
    ),
  };
}
function dailyProgress(...args: Parameters<typeof describeDailyProgress>) {
  const progress = describeDailyProgress(...args);
  return {
    ...progress,
    status: uiText(progress.status),
    detail: uiText(progress.detail),
  };
}
const LABELS: Record<string, string> = { ...LEGACY_LABELS, ...V20_LABELS };
const setupMagics = Object.fromEntries(
  V20_MAGICS.map((id) => [id, MAGICS[id]]),
) as Pick<typeof MAGICS, (typeof V20_MAGICS)[number]>;
const store = useGameStore();
const s = computed(() => store.state!);
watch(
  () => schoolTheme(s.value?.phase),
  (theme) => {
    document.documentElement.dataset.theme = theme;
  },
  { immediate: true, flush: "sync" },
);
const me = computed(() => s.value?.players[0]!);
const setup = ref<Setup>({
  name: "アリア",
  seed: "",
  magic: "barrier",
  stats: { attack: 3, defense: 3, insight: 3 },
});
const debug = ref(false),
  tab = ref("field"),
  target = ref(1),
  selected = ref<number[]>([]),
  night = ref<NightKind>("rest"),
  nightRecipe = ref("vigor"),
  nightPlan = ref<string[]>([]),
  forcedStat = ref<Stat>("attack"),
  nightPotion = ref<number | undefined>(),
  actionPotion = ref<number | undefined>(),
  shopKind = ref("obsidian"),
  tradeOffer = ref<Record<string, number>>({}),
  tradeRequest = ref<Record<string, number>>({}),
  reserveStats = ref<Partial<Record<Stat, number>>>({}),
  stance = ref<Stance>("attack"),
  battlePotion = ref<number | undefined>(),
  brought = ref<number[]>([]),
  changeMagic = ref<Magic>("foresight");
const hoNoticeDay = ref(0);
const creation = ref(false);
const graduation = ref(false);
const actionScreen = ref("");
const eventMockSelected = ref(false);
const publicActions = {
  gather: { label: "採集", cost: 1, icon: "herb" },
  research: { label: "研究", cost: 1, icon: "book" },
  event: { label: "納品", cost: 0, icon: "bag" },
  shop: { label: "購買部", cost: 1, icon: "coin" },
  trade: { label: "魔女間取引", cost: 0, icon: "spiral" },
  duel: { label: "決闘", cost: 1, icon: "sword" },
} as const;
const menu = ref("");
const menuOpener = ref<HTMLElement>();
function openMenu(
  event: MouseEvent,
  section: "inventory" | "goals" | "attributes",
) {
  menuOpener.value = event.currentTarget as HTMLElement;
  menu.value = section;
  menuTab.value = section === "inventory" ? "materials" : "daily";
}
const ruleGuideOpener = ref<HTMLElement>();
function openRuleGuide(event: MouseEvent) {
  if (!blockingModal.value)
    ruleGuideOpener.value = event.currentTarget as HTMLElement;
}
const menuTab = ref("materials");
const deferredTrades = ref<string[]>([]);
const NIGHT_ACTIONS: NightKind[] = ["raid", "curse", "guard", "rest", "scout"];
const nightActionIcons: Record<NightKind, string> = {
  raid: "sword",
  curse: "fire",
  guard: "shield",
  rest: "moon",
  scout: "eye",
  brew: "potion",
};
const actionResult = ref<string[]>([]);
const battleStep = ref("intro");
const mockResult = ref<Combat>();
const illusionPlanned = ref(false);
const latestRound = computed(() => combat.value?.rounds.at(-1));
const briefing = computed(
  () =>
    !!s.value &&
    (graduation.value ||
      (s.value.phase === "public" && hoNoticeDay.value !== s.value.day)),
);
const morningMidpoint = computed(() =>
  s.value && !graduation.value
    ? midpointNotice(s.value, hoNoticeDay.value)
    : undefined,
);
function cancelAction() {
  if (target.value === -1) target.value = 1;
  eventMockSelected.value = false;
  actionScreen.value = "";
  selected.value = [];
  reserveStats.value = {};
  nightPlan.value = [];
  actionPotion.value = undefined;
  researchPayment.value = {};
}
function openAction(id: string) {
  cancelAction();
  actionScreen.value = id;
  if (["gather", "research"].includes(id)) tab.value = "field";
  else tab.value = id;
  if (id === "brew")
    nightRecipe.value = brewCandidates.value[0]?.id ?? RECIPES[0].id;
}
function eventActionReason(action: string) {
  if (!s.value || s.value.phase !== "public" || s.value.event.resolved)
    return "公開行動中に操作できます。";
  if (store.pending) return "保存の再試行が必要です。";
  if (combat.value || s.value.challenge)
    return "先に決闘への対応を完了してください。";
  if (currentPlayer(s.value) !== 0 || s.value.publicTurn.round > 2)
    return "自分の午前・午後の手番で操作できます。";
  if (me.value.pendingRecipe) return "先に報酬を選択してください。";
  if (["gather", "research"].includes(action)) return publicAPReason.value;
  if (
    action === "mock" &&
    !s.value.players.some(
      (p) =>
        p.id !== 0 &&
        can({ type: "duel", player: 0, target: p.id, mock: true }),
    )
  )
    return "現在は模擬戦を開始できません。";
  return "";
}
function openEventAction(action: string) {
  if (eventActionReason(action)) return;
  openAction(action === "mock" ? "duel" : action);
  if (action === "mock") {
    eventMockSelected.value = true;
    target.value = s.value.players.find(
      (p) =>
        p.id !== 0 &&
        can({ type: "duel", player: 0, target: p.id, mock: true }),
    )!.id;
  }
}
function switchDuelMode(mock: boolean) {
  if (actionScreen.value !== "duel") return;
  eventMockSelected.value = mock;
  target.value = -1;
  selected.value = [];
  brought.value = [];
  battlePotion.value = undefined;
  actionPotion.value = undefined;
}
function jumpToPublicActions() {
  const choices = document.getElementById("public-action-choices");
  const hudHeight =
    document.querySelector(".turn-hud")?.getBoundingClientRect().height ?? 0;
  if (!choices) return;
  window.scrollTo({
    top: window.scrollY + choices.getBoundingClientRect().top - hudHeight - 12,
    behavior: "instant",
  });
  choices.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
}
function restoreView() {
  cancelAction();
  menu.value = "";
  actionResult.value = [];
  deferredTrades.value = [];
  graduation.value = s.value?.day === 1 && s.value?.revision === 0;
  hoNoticeDay.value = 0;
  battleStep.value = s.value?.combat?.done ? "end" : "intro";
  mockResult.value = undefined;
}
watch([() => s.value?.day, () => me.value?.night], syncNightDisplay, {
  immediate: true,
});
function syncNightDisplay() {
  const saved = me.value?.night;
  night.value = saved?.kind ?? "rest";
  nightPlan.value = [...(saved?.recipes ?? [])];
  nightRecipe.value =
    nightPlan.value[0] ??
    (s.value && hasNightRules(s.value) ? "abundance" : "vigor");
  nightPotion.value = saved?.potion;
  target.value = saved?.target ?? 1;
}
function loadSave(json?: string, rulesVersion?: string) {
  const previous = store.state;
  store.load(json, rulesVersion);
  if (store.state !== previous) {
    syncNightDisplay();
    restoreView();
    restorePresentation(json);
  }
}
function startGame() {
  const previous = store.state;
  const seed =
    debug.value && setup.value.seed.trim()
      ? setup.value.seed
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
  store.start({ ...setup.value, seed });
  if (store.state !== previous) {
    syncNightDisplay();
    restoreView();
  }
}
const event = computed(() =>
  s.value ? EVENTS[s.value.event.id - 1] : undefined,
);
const progress = computed(() => (s.value ? eventProgress(s.value) : undefined));
const phaseSteps = [
  "public",
  "magic",
  "night",
  "duels",
  "results",
  "ho",
  "dawn",
];
const total = computed(() =>
  Object.values(setup.value.stats).reduce((n, v) => n + v, 0),
);
const inventory = computed(() => {
  const counts: Record<string, { total: number; free: number }> = {};
  for (const i of me.value?.inventory ?? []) {
    counts[i.kind] ??= { total: 0, free: 0 };
    counts[i.kind].total++;
    if (!i.lock) counts[i.kind].free++;
  }
  return counts;
});
const visibleLogs = computed(
  () =>
    s.value?.logs
      .filter(
        (l) =>
          l.audience === "public" ||
          (Array.isArray(l.audience) && l.audience.includes(0)),
      )
      .filter(
        (l) => l.kind !== "trade" && (l.type !== "trade" || l.actor === 0),
      )
      .reverse() ?? [],
);
const publicHistory = computed(
  () =>
    s.value?.logs.filter(
      (l) =>
        l.day === s.value.day &&
        l.audience === "public" &&
        [
          "gather",
          "research",
          "shop",
          "reserve",
          "withdraw",
          "combatStart",
          "win",
          "turnEnd",
        ].includes(l.type),
    ) ?? [],
);
const combat = computed(() => s.value?.combat ?? mockResult.value);
const waitingForTrades = computed(
  () =>
    s.value?.phase === "public" &&
    hasPlaytestRules(s.value) &&
    s.value.publicTurn.round === 4 &&
    s.value.trades.length > 0,
);
const incomingTrades = computed(
  () => s.value?.trades.filter((t) => t.to === 0) ?? [],
);
const secretResult = computed(() =>
  !combat.value?.elemental &&
  (combat.value?.kind === "public" || combat.value?.kind === "secret") &&
  combat.value.done &&
  !combat.value.resultAcknowledged &&
  (combat.value.kind === "public" || combat.value.participants.includes(0))
    ? combat.value
    : undefined,
);
const eventResult = computed(
  () => s.value?.event.resolved && !s.value.event.acknowledged,
);
const brewCandidates = computed(() => {
  if (!me.value || me.value.night) return [];
  const copy = structuredClone(JSON.parse(JSON.stringify(me.value)));
  for (const id of nightPlan.value) {
    const ids = materialIds(copy, recipe(id)?.materials ?? []);
    if (!ids) return [];
    consume(copy, ids);
  }
  return RECIPES.filter(
    (r) => canRecipe(copy, r.id, s.value.day) && materialIds(copy, r.materials),
  );
});
const brewMaterials = computed(() =>
  me.value ? plannedMaterials(me.value, nightPlan.value) : [],
);
const brewReason = computed(() => {
  if (!me.value || !recipe(nightRecipe.value))
    return "レシピを選択してください。";
  if (me.value.night) return "この夜の行動は確定済みです。";
  if (!canRecipe(me.value, nightRecipe.value, s.value.day))
    return recipe(nightRecipe.value)?.tier === "combat"
      ? "作成には洞察Lv3が必要です。"
      : "未解放のレシピです。";
  return brewCandidates.value.some((r) => r.id === nightRecipe.value)
    ? ""
    : "作成予定分を除く素材が不足しています。";
});
watch(tab, () => {
  selected.value = [];
  reserveStats.value = {};
});
watch(
  () => combat.value?.rounds.length,
  () => {
    if (
      combat.value &&
      !legalStances(
        combat.value,
        combat.value.participants.indexOf(0),
      ).includes(stance.value)
    )
      stance.value = "attack";
    battlePotion.value = undefined;
  },
);
const donationCandidates = computed(() =>
  available(me.value).filter((i) =>
    isMaterial(i.kind)
      ? !!event.value?.materials &&
        (!event.value.allowed || event.value.allowed.includes(i.kind)) &&
        (event.value.id !== 11 || i.kind === s.value.event.specified)
      : !!event.value?.potions,
  ),
);
const reserveReason = computed(() =>
  !selected.value.length && !Object.values(reserveStats.value).some(Boolean)
    ? ""
    : actionError({
        type: "reserve",
        player: 0,
        items: selected.value,
        stats: reserveStats.value,
      }),
);
const showGameDialogs = computed(
  () => !store.pending && !briefing.value && !actionResult.value.length,
);
const tradeNotice = computed(() => {
  if (
    !showGameDialogs.value ||
    menu.value ||
    combat.value ||
    s.value?.challenge ||
    eventResult.value ||
    s.value?.publicOutcome
  )
    return undefined;
  return incomingTrades.value.find(
    (trade) => !deferredTrades.value.includes(tradeNoticeKey(trade.id)),
  );
});
function tradeNoticeKey(id: number) {
  return [s.value.day, s.value.publicTurn.round === 4, id].join(":");
}
const challengeNotice = computed(() =>
  showGameDialogs.value && !menu.value ? s.value?.challenge : undefined,
);
const blockingModal = computed(
  () =>
    !!store.pending ||
    !!ruleGuideOpener.value ||
    !!menu.value ||
    !!tradeNotice.value ||
    !!challengeNotice.value ||
    (showGameDialogs.value &&
      ((!!secretResult.value &&
        (!myCombat.value || battleStep.value === "end")) ||
        !!eventResult.value ||
        !!s.value?.publicOutcome)),
);
const hoProgress = computed(() =>
  s.value ? dailyProgress(s.value, me.value) : undefined,
);
const interruptReason = computed(() => {
  if (waitingForTrades.value)
    return "公開行動の終了待ちです。残っている取引を受諾・拒否、または撤回してください。";
  if (secretResult.value)
    return `${secretResult.value.kind === "public" ? "公開" : "秘匿"}決闘の結果確認待ちです。内容を確認して確認したを押してください。`;
  if (combat.value)
    return combat.value.done
      ? "勝利報酬の選択待ちです。"
      : "決闘中のため公開行動はできません。";
  if (s.value?.challenge)
    return "挑戦への返答待ちです。対戦・降参を選んでください。";
  if (
    s.value?.phase === "public" &&
    currentPlayer(s.value) !== 0 &&
    s.value.publicTurn.round < 4
  )
    return "他の魔女の手番です。";
  if (s.value?.publicTurn.acted && s.value.phase === "public")
    return "この手番の1AP行動は完了しました。0AP操作後、手番を終了してください。";
  return "";
});
const publicAPReason = computed(() => {
  const state = s.value;
  if (!state || state.phase !== "public") return "";
  if (state.publicTurn.round > 2) return "午前・午後の公開行動は終了しました。";
  if (currentPlayer(state) !== 0) return "他の魔女の手番です。";
  if (state.publicTurn.acted)
    return me.value.ap > 0
      ? "この時間帯では1AP行動を使用済みです。残りAPは午後に持ち越します。"
      : "この時間帯では1AP行動を使用済みです。残りAPはありません。";
  if (me.value.ap < 1) return "AP不足のため、1AP行動はできません。";
  if (me.value.commands.length) return "先に行動制限・命令を処理してください。";
  return "";
});
const nightResults = computed(() =>
  visibleLogs.value.filter(
    (l) =>
      l.day === s.value?.day &&
      ["night", "duels", "rewards", "results", "ho", "dawn"].includes(
        l.phase,
      ) &&
      (l.actor === 0 || l.target === 0) &&
      !["combatRound", "combatAck", "fp", "levelUp"].includes(l.type),
  ),
);
const personalResults = computed(
  () =>
    s.value?.logs.filter(
      (l) =>
        l.day === s.value.day &&
        (l.audience === "public" ||
          (Array.isArray(l.audience) && l.audience.includes(0))) &&
        (l.actor === 0 || l.target === 0) &&
        !(l.type === "fp" && l.kind === "ho") &&
        ["fp", "levelUp"].includes(l.type),
    ) ?? [],
);

const dawnSummary = computed(() => {
  if (!s.value || !hasRevisedNightRules(s.value)) return;
  const day = s.value.day;
  if (!["dawn", "ended"].includes(s.value.phase)) return;
  const logs = visibleLogs.value
    .filter((l) => l.day === day && (l.actor === 0 || l.target === 0))
    .sort((a, b) => a.seq - b.seq);
  const task = me.value.dailyHistory.find((h) => h.day === day);
  if (!logs.some((l) => l.type === "nightInventory") || !task) return;
  return {
    ...dailyReview(s.value),
    task,
    actions: logs.filter(
      (l) =>
        ["night", "duels", "rewards", "results"].includes(l.phase) &&
        [
          "nightChoice",
          "combat",
          "automaticBattle",
          "raidBlocked",
          "curseBlocked",
          "curseHit",
          "cursed",
          "rest",
          "guard",
          "scout",
          "scoutBlocked",
          "loot",
          "command",
          "brew",
          "usePotion",
        ].includes(l.type) &&
        (l.type !== "combat" || l.actor === 0),
    ),
  };
});
const nightEffect = computed(
  () =>
    ({
      raid:
        "対象を襲い、勝つと報酬を選べます。休息中の相手には自動勝利。火Lv−1の補正を戦闘中に一度使えます（現在＋" +
        (level(me.value.stats.attack) - 1) +
        "）。",
      curse:
        "対象の翌日の採集・研究を妨害します。火Lv1は1回分、Lv2は2回分、Lv3では購買部の必要素材も＋1個。",
      guard:
        "偵察を受けると戦闘になります。水Lv−1の警戒補正を戦闘中に一度使えます（現在＋" +
        (level(me.value.stats.defense) - 1) +
        "）。",
      rest: "襲撃されずに休息すると、翌日の採集・研究が有利になります。水Lv1は1回分、Lv2は2回分、Lv3では購買部の必要素材も−1個。",
      brew: "",
      scout:
        "対象の夜間行動を調べます。警戒中の相手には勝利が必要です。戦闘に勝って情報を得ると相手のFPを1減らします。偵察自体にLv補正はありません。",
    })[night.value],
);
watch(
  () => combat.value?.id,
  () => {
    brought.value = [];
    battlePotion.value = undefined;
    stance.value = "attack";
  },
);
watch(
  () => s.value?.revision,
  () => {
    if (!me.value) return;
    const ids = available(me.value).map((i) => i.id);
    if (actionPotion.value !== undefined && !ids.includes(actionPotion.value))
      actionPotion.value = undefined;
    if (nightPotion.value !== undefined && !ids.includes(nightPotion.value))
      nightPotion.value = undefined;
  },
);
const mySide = computed(() => combat.value?.participants.indexOf(0) ?? -1);
const myCombat = computed(() => mySide.value >= 0);
const selectedElement = ref<Stat>("attack");
const bonusRound = ref(false);
const modernNight = computed(() => !!s.value && hasNightRules(s.value));
const modernReward = computed(() =>
  s.value?.phase === "rewards" && modernNight.value
    ? rewardOptions(s.value)
    : undefined,
);
const researchPayment = ref<Partial<Record<Stat, string>>>({});
const nightDraft = computed<Action>(() => ({
  type: "night",
  player: 0,
  choice: {
    kind: night.value,
    target: target.value === 0 ? 1 : target.value,
    recipes: [...nightPlan.value],
  },
}));
function researchCost(stat: Stat) {
  const cost = modernNight.value
    ? publicResearchCost(me.value, stat, researchPayment.value[stat])
    : (isV20(s.value) ? V20_RESEARCH : RESEARCH)[stat];
  if (!cost) return null;
  return [...new Set(cost)].map(
    (kind) => [kind, cost.filter((item) => item === kind).length] as const,
  );
}
const scholarshipActive = computed(
  () => modernNight.value && !!me.value?.publicPotions?.includes("scholarship"),
);
function researchGrowth(stat: Stat, forced = false) {
  if (modernNight.value) return publicResearchGrowth(me.value);
  // Older rules can change growth when a potion is selected with the action.
  try {
    const next = dispatch(
      s.value,
      forced
        ? { type: "forced", player: 0, kind: "research", stat }
        : { type: "research", player: 0, stat, potion: actionPotion.value },
    );
    return next.players[0].stats[stat] - me.value.stats[stat];
  } catch {
    return undefined;
  }
}
const researchGrowthByStat = computed(() =>
  Object.fromEntries(STATS.map((stat) => [stat, researchGrowth(stat)])),
);
const forcedResearchGrowth = computed(() =>
  researchGrowth(forcedStat.value, true),
);
function logText(entry: Log) {
  // Modern level effects are shown from current rules in the attribute UI.
  if (modernNight.value && entry.type === "levelUp" && entry.amount) {
    const suffix = levelEffect(entry.kind as Stat, entry.amount);
    return entry.text.endsWith(suffix)
      ? entry.text.slice(0, -suffix.length)
      : entry.text;
  }
  return entry.text;
}
const modifiers = computed(() =>
  me.value ? publicModifiers(me.value) : { gather: 0, research: 0, shop: 0 },
);
watch(
  () => s.value?.revision,
  () => {
    bonusRound.value = false;
  },
);
const elementalPotionChoices = computed(
  () =>
    combat.value?.brought[mySide.value]?.filter(
      (item) => item.kind === ELEMENT_POTIONS[selectedElement.value].id,
    ) ?? [],
);
watch([selectedElement, () => combat.value?.id], () => {
  battlePotion.value = undefined;
});
watch(
  () => combat.value?.id,
  () => {
    selectedElement.value = "attack";
  },
);
const history = computed(
  () =>
    s.value?.combatHistory
      .filter((c) => c.kind !== "secret" || c.participants.includes(0))
      .reverse() ?? [],
);
const itemName = (kind: string) =>
  LABELS[kind] ??
  modernRecipe(kind)?.name ??
  elementPotion(kind)?.name ??
  recipe(kind)?.name ??
  kind;
const describeTrade = (items: Record<string, number>) =>
  Object.entries(items)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${itemName(kind)} ×${count}`)
    .join("・") || "なし";
let pendingAction: Action | undefined;
function retrySave() {
  if (pendingAction) act(pendingAction, true);
  else store.save();
}
function act(a: Action, retry = false) {
  if (!retry && store.pending) return;
  const previous = s.value;
  const seq = previous?.logs.at(-1)?.seq ?? 0;
  if (retry) store.save();
  else store.act(a);
  if (store.pending) {
    pendingAction = a;
    return;
  }
  pendingAction = undefined;
  if (s.value !== previous) {
    // A real day transition can establish the previous morning even when an old
    // day-four save had no optional UI metadata. Loading a day-five save cannot.
    if (previous.day === 4 && s.value.day === 5 && hoNoticeDay.value < 4)
      hoNoticeDay.value = 4;
    if (s.value.combat?.id !== previous?.combat?.id)
      battleStep.value = s.value.combat?.done ? "end" : "intro";
    if (
      a.type === "reward" ||
      (a.type === "combatAck" &&
        !modernNight.value &&
        previous.combat?.kind !== "public")
    ) {
      const lines = s.value.logs
        .filter(
          (l) =>
            l.seq > seq &&
            l.type !== "combatAck" &&
            (l.audience === "public" ||
              (Array.isArray(l.audience) && l.audience.includes(0))),
        )
        .map(logText);
      const changes = s.value.players
        .map((p, i) =>
          p.inventory.length !== previous.players[i].inventory.length ||
          p.fp !== previous.players[i].fp
            ? `${p.id === 0 ? "あなた" : p.name}：アイテム合計 ${previous.players[i].inventory.length} → ${p.inventory.length}、名声 ${previous.players[i].fp} → ${p.fp}`
            : "",
        )
        .filter(Boolean);
      if (lines.length || changes.length)
        actionResult.value = [...lines, ...changes];
    }
    if (a.type === "trade" || a.type === "tradeReply") {
      const logs = s.value.logs.filter((l) => l.seq > seq);
      const trade = logs.find((l) => l.type === "trade" && l.actor === 0);
      const counterpart =
        trade?.target ??
        (a.type === "trade"
          ? a.target
          : previous.trades.find((t) => t.id === a.id)?.from);
      const name =
        counterpart === undefined ? "相手" : s.value.players[counterpart].name;
      const offered = (trade?.data?.offered ?? []) as string[];
      const requested = (trade?.data?.receivedKinds ?? []) as string[];
      const [given, got] =
        a.type === "trade" ? [offered, requested] : [requested, offered];
      const describe = (items: string[]) =>
        items.map(itemName).join("・") || "なし";
      store.notice = trade
        ? name +
          "と取引成立。渡した品：" +
          describe(given) +
          " ／ 受け取った品：" +
          describe(got)
        : (logs.find(
            (l) =>
              l.type === "tradeRejected" && (l.actor === 0 || l.target === 0),
          )?.text ?? "取引を提案しました。");
      actionScreen.value = "";
    } else if (a.type === "night") {
      actionScreen.value = "";
      menu.value = "";
    } else if (a.type === "nightReward") {
      const reward = s.value.logs.find(
        (l) =>
          l.seq > seq &&
          l.actor === 0 &&
          (l.type === "loot" || l.type === "command"),
      );
      if (reward) store.notice = uiText(reward.text);
    } else if (a.type === "round") {
      if (!s.value.combat && previous?.combat?.kind === "mock")
        mockResult.value = s.value.combatHistory.at(-1);
      battleStep.value = "reveal";
    } else if (
      [
        "gather",
        "research",
        "forced",
        "reserve",
        "withdraw",
        "shop",
        "magic",
        "usePotion",
      ].includes(a.type)
    ) {
      actionResult.value = s.value.logs
        .filter(
          (l) =>
            l.seq > seq &&
            l.type !== "combatAck" &&
            (l.audience === "public" ||
              (Array.isArray(l.audience) && l.audience.includes(0))),
        )
        .map(logText);
      if (!actionResult.value.length)
        actionResult.value = ["行動を確定しました。"];
      actionScreen.value = "";
      menu.value = "";
    }
  }
  selected.value = [];
  battlePotion.value = undefined;
}
function actionError(a: Action) {
  if (!s.value) return "研究を開始してください";
  if (store.pending) return "保存の再試行が必要です";
  try {
    dispatch(s.value, JSON.parse(JSON.stringify(a)));
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}
function can(a: Action) {
  return !actionError(a);
}
function presentation() {
  return {
    version: 1,
    key: JSON.stringify([s.value?.setup, s.value?.actions]),
    graduation: graduation.value,
    day: hoNoticeDay.value,
    actionResult: actionResult.value,
    battleStep: battleStep.value,
    mockResult: mockResult.value,
  };
}
function presentationKey() {
  return "majoken-ui-rules-" + s.value.rulesVersion.replace("browser-", "");
}
function restorePresentation(json?: string) {
  try {
    const view = json
      ? JSON.parse(json).presentation
      : JSON.parse(localStorage.getItem(presentationKey()) ?? "null");
    if (
      view?.version !== 1 ||
      view.key !== JSON.stringify([s.value?.setup, s.value?.actions])
    )
      return;
    graduation.value = view.graduation === true;
    hoNoticeDay.value = Number.isInteger(view.day) ? view.day : 0;
    actionResult.value =
      s.value.actions.at(-1)?.type !== "night" &&
      Array.isArray(view.actionResult)
        ? view.actionResult.filter((x: unknown) => typeof x === "string")
        : [];
    if (
      ["intro", "choose", "reveal", "judgment", "end"].includes(view.battleStep)
    )
      battleStep.value = view.battleStep;
    // Use the validated game history; never trust a supplied combat snapshot.
    if (
      view.mockResult &&
      s.value?.combatHistory.at(-1)?.kind === "mock" &&
      s.value.actions.at(-1)?.type === "round"
    )
      mockResult.value = s.value.combatHistory.at(-1);
  } catch {
    /* Optional UI metadata must not prevent a valid game from loading. */
  }
}
watch(
  [
    () => s.value,
    graduation,
    hoNoticeDay,
    actionResult,
    battleStep,
    mockResult,
  ],
  () => {
    if (!s.value) return;
    try {
      localStorage.setItem(presentationKey(), JSON.stringify(presentation()));
    } catch {
      /* Game save and JSON export remain available. */
    }
  },
  { flush: "post" },
);
function download() {
  if (!s.value) return;
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          { ...JSON.parse(serialize(s.value)), presentation: presentation() },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `majoken-day${s.value.day}-${s.value.seed.replace(/[^\w-]/g, "_")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
async function copySeed() {
  try {
    await navigator.clipboard.writeText(s.value.seed);
    store.notice = "乱数シードをコピーしました。";
  } catch {
    store.notice =
      "コピーできませんでした。乱数シード欄から手動でコピーできます。";
  }
}
async function upload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) {
    if (file.size > 10_000_000) {
      store.error = "10MB以下のセーブを選択してください";
      return;
    }
    loadSave(await file.text());
  }
  (e.target as HTMLInputElement).value = "";
}
const tradePreview = computed(() => {
  if (!s.value) return { reason: "研究を開始してください" };
  if (
    Object.values(tradeOffer.value).some(
      (n) => !Number.isSafeInteger(n) || n < 0,
    )
  )
    return { reason: "提供数は0以上の整数で指定してください" };
  const ids: number[] = [];
  const pool = available(me.value);
  for (const [kind, count] of Object.entries(tradeOffer.value)) {
    const items = pool.filter((item) => item.kind === kind);
    if (count > items.length) return { reason: "提供品が不足しています" };
    ids.push(...items.slice(0, count).map((item) => item.id));
  }
  return {
    reason: actionError({
      type: "trade",
      player: 0,
      target: target.value,
      offer: ids,
      request: tradeRequest.value,
    }),
  };
});
function offer() {
  if (
    Object.values(tradeOffer.value).some(
      (n) => !Number.isSafeInteger(n) || n < 0,
    )
  ) {
    store.error = "提供数は0以上の整数で指定してください";
    return;
  }
  const pool = available(me.value!);
  const ids: number[] = [];
  for (const [kind, n] of Object.entries(tradeOffer.value))
    for (let i = 0; i < n; i++) {
      const item = pool.find((x) => x.kind === kind && !ids.includes(x.id));
      if (!item) {
        store.error = "提供品が不足しています";
        return;
      }
      ids.push(item.id);
    }
  act({
    type: "trade",
    player: 0,
    target: target.value,
    offer: ids,
    request: tradeRequest.value,
  });
}
const nightStatus = computed(() =>
  s.value ? nightReadiness(s.value, !!store.pending) : undefined,
);
function resolveNight() {
  if (!nightStatus.value?.canResolve) return;
  act({ type: "advance" });
}
function next() {
  if (s.value?.phase === "night" && modernNight.value) {
    resolveNight();
    return;
  }
  act(
    s.value?.phase === "public" && s.value.publicTurn.round <= 2
      ? { type: "endTurn", player: 0 }
      : { type: "advance", pauseAtDawn: true },
  );
}
const nextLabel = computed(
  () =>
    ({
      public: "手番終了 / パス",
      magic: "秘匿行動へ",
      vote:
        s.value && hasRevisedNightRules(s.value)
          ? "予知の選択を確定"
          : "投票を締め切る",
      night: "秘匿行動を解決",
      duels: "秘匿決闘を進める",
      results: "夜結果を確定",
      ho:
        s.value && hasRevisedNightRules(s.value)
          ? "課題を判定して夜明けへ"
          : "今日の課題を判定",
      dawn: "次の日へ",
      ended: "終了",
      rewards: "報酬選択",
    })[s.value?.phase ?? "public"],
);
watch(
  () => [s.value?.day, s.value?.phase, combat.value?.id].join(":"),
  () => {
    actionScreen.value = "";
  },
);
watch(
  () =>
    [
      s.value?.day,
      s.value?.phase,
      briefing.value,
      creation.value,
      actionScreen.value,
      actionResult.value.length,
      battleStep.value,
      combat.value?.id,
      !!eventResult.value,
      !!secretResult.value,
    ].join(":"),
  async () => {
    await nextTick();
    const anchor = document.querySelector<HTMLElement>(".turn-hud-anchor");
    window.scrollTo({
      top: anchor ? window.scrollY + anchor.getBoundingClientRect().top : 0,
      behavior: "instant",
    });
    document
      .querySelector<HTMLElement>(".briefing h2, main h2, .center-column h2")
      ?.focus({ preventScroll: true });
  },
);
</script>

<template>
  <div class="app-shell" :inert="blockingModal">
    <header class="topbar">
      <a class="brand" href="./"
        ><span class="brand-mark">✧</span
        ><span
          >魔女たちの共同研究<small>THE WITCHES' JOINT RESEARCH</small></span
        ></a
      >
      <div class="top-actions">
        <span class="version">v2.0 開発版 · 夜間処理</span
        ><button @click="loadSave()">続きから</button>
        <button
          v-if="store.releasedSaveAvailable"
          @click="loadSave(undefined, V20_RELEASE_RULES_VERSION)"
        >
          旧v2.0の続きから
        </button>
        <button
          v-if="store.npcRulesSaveAvailable"
          @click="loadSave(undefined, V20_NPC_RULES_VERSION)"
        >
          旧v2.0.3の続きから
        </button>
        <button
          v-if="store.previousSaveAvailable"
          @click="loadSave(undefined, V20_PREVIOUS_RULES_VERSION)"
        >
          旧v2.0.2の続きから
        </button>
        <button
          v-if="store.playtestSaveAvailable"
          @click="loadSave(undefined, V20_PLAYTEST_RULES_VERSION)"
        >
          旧v2.0.1の続きから
        </button>
        <button v-if="s" aria-haspopup="dialog" @click="openRuleGuide">
          遊び方・ルール説明
        </button>
        <template v-if="s"
          ><button @click="store.save()">保存</button
          ><button @click="download">JSON保存</button></template
        ><label class="button"
          >JSON読込<input
            type="file"
            accept=".json,application/json"
            class="file-input"
            @change="upload"
        /></label>
      </div>
    </header>
    <div v-if="store.error && !store.pending" role="alert" class="alert error">
      {{ uiText(store.error) }}<button @click="store.error = ''">閉じる</button>
    </div>
    <div v-if="store.notice" role="status" class="alert">
      {{ store.notice }}<button @click="store.notice = ''">閉じる</button>
    </div>
    <main v-if="!s" class="setup-layout">
      <section v-if="!creation" class="intro">
        <p class="eyebrow">8日間 / 4人の魔女 / ひとつの研究所</p>
        <div class="sigil" aria-hidden="true">✦<span>☽</span></div>
        <h1>
          仲良くしないと負ける。<br />でも、仲良くするだけじゃ<br /><em
            >勝てない。</em
          >
        </h1>
        <p class="lead">
          研究所を守る8日間。<br />公開行動、協力イベント、夜間行動を進めて研究所の8日間を遊べます。
        </p>
        <button class="primary start-button" @click="creation = true">
          ゲーム開始 →
        </button>
        <div class="intro-rules">
          <button aria-haspopup="dialog" @click="openRuleGuide">
            遊び方・ルール説明
          </button>
        </div>
        <div class="intro-notes">
          <span>01　共同研究を成功させる</span
          ><span>02　卒業課題で卒業を目指す</span
          ><span>03　今日の課題と名声で首席を競う</span>
        </div>
        <p class="muted">
          ブラウザ内で動く試験用ゲームです。保存データ・開発者表示には秘密情報を含みます。
        </p>
      </section>
      <section v-else class="panel creation">
        <p class="eyebrow">キャラクターメイク</p>
        <h2>研究所へようこそ</h2>
        <p class="muted">名前、魔法、能力を決めて研究を始めましょう。</p>
        <label>魔女の名前<input v-model="setup.name" maxlength="24" /></label>
        <label class="checkbox-row">
          <input v-model="debug" type="checkbox" />開発者モード
        </label>
        <p class="muted">
          開発者モードではプレイ中に全員の秘密情報を表示します。
        </p>
        <template v-if="debug">
          <label
            >乱数シード<input v-model="setup.seed" maxlength="100"
          /></label>
          <p class="muted">
            空欄なら自動生成します。同じシードと初期設定で初期抽選を再現できます。
          </p>
        </template>
        <div class="field-label">固有魔法</div>
        <div class="magic-options">
          <button
            v-for="(m, id) in setupMagics"
            :key="id"
            :class="{ chosen: setup.magic === id }"
            @click="setup.magic = id"
          >
            <strong>{{ m.name }}</strong
            ><small>再使用まで {{ m.cd }}日</small>
          </button>
        </div>
        <p class="magic-description">{{ MAGICS[setup.magic].description }}</p>
        <div class="field-label">
          能力の配分
          <span :class="total === 9 ? 'mint' : 'pink'">{{ total }} / 9</span>
        </div>
        <div class="stat-inputs">
          <label v-for="k in STATS" :key="k"
            ><GameIcon :kind="k" :legacy="!!s && !isV20(s)" />{{ LABELS[k]
            }}<input
              v-model.number="setup.stats[k]"
              type="number"
              min="2"
              max="5"
          /></label>
        </div>
        <p class="muted">各能力2＋自由3ポイント。能力6でLv2、9でLv3。</p>
        <button
          class="primary start-button"
          :disabled="total !== 9 || !setup.name.trim()"
          @click="startGame"
        >
          研究開始
        </button>
        <p class="center muted">あなた1人＋AI3人・時間制限なし</p>
      </section>
    </main>
    <template v-else-if="me">
      <div class="session-bar">
        <div>
          <span class="eyebrow">研究の進行</span>
          <h1>第 {{ s.day }} 日 <span>/ 8</span></h1>
        </div>
        <nav aria-label="進行状況">
          <span
            v-for="(p, i) in phaseSteps.filter(
              (step) => !hasRevisedNightRules(s) || step !== 'dawn',
            )"
            :key="p"
            :class="{ active: s.phase === p }"
            ><small>0{{ i + 1 }}</small
            >{{
              p === "ho" && hasRevisedNightRules(s)
                ? "課題判定・夜明け"
                : LABELS[p]
            }}</span
          >
        </nav>
      </div>
      <div class="turn-hud-anchor" aria-hidden="true"></div>
      <TurnStatus
        :day="s.day"
        :phase="
          s.phase === 'ho' && hasRevisedNightRules(s)
            ? '課題判定・夜明け'
            : LABELS[s.phase]
        "
        :time="
          s.phase === 'public' && s.publicTurn.round <= 2
            ? s.publicTurn.round === 1
              ? '午前'
              : '午後'
            : s.phase === 'dawn' || s.phase === 'ho'
              ? '夜明け'
              : s.phase === 'public'
                ? '公開行動終了'
                : s.phase === 'ended'
                  ? '研究終了'
                  : '夜'
        "
        :ap="me.ap"
        :fp="me.fp"
        :public-phase="s.phase === 'public'"
        :acted="s.publicTurn.acted"
        :own-turn="currentPlayer(s) === 0 && s.publicTurn.round <= 2"
        :reason="
          !combat && s.phase === 'public'
            ? publicAPReason || interruptReason
            : ''
        "
      />
      <button
        v-if="
          s.phase === 'public' &&
          !briefing &&
          !actionResult.length &&
          !combat &&
          !s.challenge &&
          !actionScreen &&
          !s.event.resolved
        "
        type="button"
        class="mobile-action-jump"
        aria-controls="public-action-choices"
        @click="jumpToPublicActions"
      >
        <strong>行動を選ぶ</strong><span>採集・研究など ↓</span>
      </button>
      <InstituteHealth :failed="s.failed" />
      <section
        v-if="
          !modernNight && s.event.resolved && s.event.acknowledged && !s.result
        "
        class="panel persistent-turn"
        role="status"
      >
        <strong>今回の試遊範囲はここまで</strong>
        <span
          >協力イベントは{{
            s.event.success ? "成功" : "失敗"
          }}しました。夜間処理は次の実装段階です。</span
        >
      </section>

      <div
        v-if="
          incomingTrades.length && !tradeNotice && !combat && !challengeNotice
        "
        class="trade-inbox"
      >
        <button @click="deferredTrades = []">
          未回答の取引を確認（{{ incomingTrades.length }}件）
        </button>
      </div>
      <TaskBriefing
        v-if="briefing"
        :graduation="graduation"
        :midpoint="morningMidpoint"
        :day="s.day"
        :name="
          goalDescription(graduation ? me.longGoal : me.dailyGoal, graduation)
            .name
        "
        :condition="
          goalDescription(graduation ? me.longGoal : me.dailyGoal, graduation)
            .condition
        "
        @confirm="graduation ? (graduation = false) : (hoNoticeDay = s.day)"
      />
      <section
        v-else-if="actionResult.length"
        class="panel focus-screen action-result"
      >
        <h2 tabindex="-1">行動の結果</h2>
        <p v-for="(line, i) in actionResult" :key="i">{{ uiText(line) }}</p>
        <p>残りAP：{{ me.ap }} / 2</p>
        <p v-if="publicAPReason">{{ publicAPReason }}</p>
        <button class="primary" @click="actionResult = []">確認した</button>
      </section>
      <div
        v-else
        class="game-grid"
        :class="{
          'battle-screen': !!combat,
          'action-detail': !!actionScreen,
          'public-home': s.phase === 'public' && !actionScreen && !combat,
        }"
      >
        <aside v-if="!combat" class="left-column">
          <EventOverview
            v-if="s.phase === 'public' && !actionScreen"
            class="event-preview"
            :state="s"
            shortcuts
            :reason-for="eventActionReason"
            @navigate="openEventAction"
          />
          <section
            v-if="s.phase === 'public' && !actionScreen"
            class="panel task-glance"
            aria-label="自分の今日の課題"
          >
            <span class="eyebrow">自分の今日の課題</span>
            <h3>{{ goalDescription(me.dailyGoal, false).name }}</h3>
            <p>{{ hoProgress?.status }}</p>
            <details>
              <summary>達成条件と進捗</summary>
              <p>{{ goalDescription(me.dailyGoal, false).condition }}</p>
              <p>{{ hoProgress?.detail }}</p>
            </details>
          </section>

          <details v-if="!actionScreen" class="panel witches-overview">
            <summary>研究室の魔女たち・公開情報</summary>
            <div class="section-heading">
              <h2>研究室の魔女たち</h2>
              <small>公開情報</small>
            </div>
            <article
              v-for="p in s.players"
              :key="p.id"
              class="witch-card"
              :class="{ you: p.id === 0 }"
            >
              <div class="witch-avatar" :class="`avatar-${p.id}`">
                {{ ["☽", "✦", "❋", "◇"][p.id] }}
              </div>
              <div class="witch-info">
                <div>
                  <strong>{{ p.name }}</strong
                  ><span class="tag">{{ p.ai ? "AI" : "あなた" }}</span
                  ><b class="fp">{{ p.fp }} <small>FP</small></b>
                </div>
                <div class="stats">
                  <span v-for="k in STATS" :key="k"
                    ><GameIcon :kind="k" :legacy="!!s && !isV20(s)" />{{
                      LABELS[k]
                    }}
                    <b>{{ p.stats[k] }}</b
                    ><small v-if="p.id === 0"
                      >Lv{{ level(p.stats[k]) }}</small
                    ></span
                  >
                </div>
                <small
                  >素材
                  {{
                    p.inventory.filter((item) => isMaterial(item.kind)).length
                  }}
                  個 · 薬
                  {{
                    p.inventory.filter((item) => !isMaterial(item.kind)).length
                  }}
                  個</small
                >
              </div>
            </article>
          </details>
          <nav v-if="!s.result" class="common-menu" aria-label="共通メニュー">
            <button @click="openMenu($event, 'inventory')">
              <GameIcon kind="bag" /><br />持ち物
            </button>
            <button @click="openMenu($event, 'attributes')">
              <GameIcon kind="star" /><br />能力値
            </button>
            <button @click="openMenu($event, 'goals')">
              <GameIcon kind="book" /><br />課題
            </button>
          </nav>
          <details v-if="!actionScreen" class="panel level-guide">
            <summary>あなたの能力Lvと解禁効果</summary>
            <AttributeDetails
              v-for="k in STATS"
              :key="k"
              :label="LABELS[k]"
              :stat="k"
              :value="me.stats[k]"
              :rules-version="s.rulesVersion"
              :recipes="me.recipes"
            />
          </details>
        </aside>
        <main class="center-column">
          <section v-if="s.result" class="panel final-results">
            <p class="eyebrow">研究終了</p>
            <h2>
              {{
                s.result.reason === "collapse"
                  ? "研究所は崩壊しました"
                  : "8日間の研究、おつかれさま。"
              }}
            </h2>
            <p>
              {{
                s.result.reason === "collapse"
                  ? "協力イベントが3回失敗したため、全員敗北です。"
                  : s.result.chiefs.length
                    ? `首席：${s.result.chiefs.map((id) => s.players[id].name).join("・")}`
                    : "卒業者なし：卒業課題達成者がいません。"
              }}
            </p>
            <p
              v-if="
                s.result.reason === 'collapse' && !s.result.graduates.length
              "
            >
              卒業者なし
            </p>
            <div class="results-table">
              <table>
                <thead>
                  <tr>
                    <th>魔女</th>
                    <th>卒業</th>
                    <th>今日の課題</th>
                    <th>FP順位</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in s.result.ranking" :key="r.player">
                    <td>{{ s.players[r.player].name }}</td>
                    <td>{{ r.graduated ? "卒業" : "未卒業" }}</td>
                    <td>{{ r.daily }}回</td>
                    <td>
                      {{ r.rank === null ? "順位なし" : `${r.rank}位` }} /
                      {{ r.fp }}FP
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <details v-for="p in s.players" :key="p.id">
              <summary>{{ p.name }}の課題と判定根拠</summary>
              <h3>
                {{ goalDescription(p.longGoal, true).name }}：{{
                  p.longGoal.achieved ? "達成" : "未達成"
                }}
              </h3>
              <p>{{ goalDescription(p.longGoal, true).condition }}</p>
              <p v-for="h in p.dailyHistory" :key="h.day">
                第{{ h.day }}日：{{
                  goalDescription(
                    { id: h.id, targets: [], achieved: h.achieved },
                    false,
                  ).name
                }}
                {{ h.achieved ? "✓" : "—" }}
              </p>
            </details>
            <p class="muted">
              卒業者を最終FPで順位付けします。同点の場合は日次課題の達成数を比較し、両方同じなら同率です。
            </p>
            <button @click="store.state = undefined">新しい研究を始める</button>
          </section>
          <section v-if="me.pendingRecipe && !combat" class="panel">
            <h2>10FP到達 · 特殊レシピを選択</h2>
            <button
              v-for="r in RECIPES.filter(
                (r) => r.tier === 'special' && !me.recipes.includes(r.id),
              )"
              :key="r.id"
              @click="act({ type: 'unlock', player: 0, recipe: r.id })"
            >
              {{ r.name }}
            </button>
          </section>
          <section
            v-if="combat?.elemental && myCombat"
            class="panel combat-panel"
          >
            <h2>
              {{
                combat.kind === "mock"
                  ? "公開模擬戦"
                  : combat.kind === "secret"
                    ? "秘匿決闘"
                    : "公開決闘"
              }}
            </h2>
            <div class="battle-header" role="status">
              <strong
                >第{{
                  Math.min(
                    5,
                    combat.elemental.rounds.length + Number(!combat.done),
                  )
                }}ラウンド / 最大5</strong
              >
              <div class="duel-scoreboard">
                <article
                  v-for="side in [mySide, 1 - mySide]"
                  :key="side"
                  class="duel-fighter"
                  :class="{ you: side === mySide }"
                >
                  <strong>{{
                    s.players[combat.participants[side]].name
                  }}</strong>
                  <span class="duel-hp"
                    ><small>HP</small> {{ combat.hp[side] }}</span
                  >
                  <div class="stats">
                    <span v-for="stat in STATS" :key="stat"
                      ><GameIcon :kind="stat" />{{ LABELS[stat] }}
                      <b>{{
                        s.players[combat.participants[side]].stats[stat]
                      }}</b>
                      <small
                        >Lv{{
                          level(
                            s.players[combat.participants[side]].stats[stat],
                          )
                        }}</small
                      ></span
                    >
                  </div>
                </article>
              </div>
            </div>
            <template v-if="!combat.elemental.ready[mySide]">
              <h3>上位薬の持ち込み</h3>
              <p>最大2個。確定時に消費し、未使用分も返却しません。</p>
              <label
                v-for="item in available(me).filter((i) =>
                  elementPotion(i.kind),
                )"
                :key="item.id"
                class="checkbox-row"
              >
                <input
                  v-model="brought"
                  type="checkbox"
                  :value="item.id"
                /><GameIcon :kind="item.kind" />{{ itemName(item.kind) }}
              </label>
              <button
                class="primary"
                :disabled="!can({ type: 'loadout', player: 0, items: brought })"
                @click="act({ type: 'loadout', player: 0, items: brought })"
              >
                {{ brought.length ? "持ち込みを確定" : "持ち込まずに進む" }}
              </button>
            </template>
            <template v-else-if="combat.elemental.pending">
              <p>あなたの属性と薬は確定済みです。</p>
              <button
                class="primary"
                :disabled="!!store.pending"
                @click="act({ type: 'elementReply', player: 0 })"
              >
                ラウンド結果を見る
              </button>
            </template>
            <template v-else-if="!combat.done">
              <CombatAffinity elemental :selected="selectedElement" />
              <p v-if="combat.kind === 'mock'">
                模擬戦では上位薬を使用しません。
              </p>
              <div class="stance-options">
                <button
                  v-for="element in STATS"
                  :key="element"
                  :aria-pressed="selectedElement === element"
                  :class="{ chosen: selectedElement === element }"
                  @click="selectedElement = element"
                >
                  <GameIcon :kind="element" />{{ LABELS[element] }}
                </button>
              </div>
              <label v-if="elementalPotionChoices.length"
                >このラウンドの薬
                <select v-model="battlePotion">
                  <option :value="undefined">使わない</option>
                  <option
                    v-for="item in elementalPotionChoices"
                    :key="item.id"
                    :value="item.id"
                  >
                    {{ itemName(item.kind) }}
                  </option>
                </select>
              </label>
              <label
                v-if="
                  combat.elemental.bonus?.[mySide] &&
                  !combat.elemental.spent?.[mySide]
                "
              >
                <input
                  v-model="bonusRound"
                  type="checkbox"
                />このラウンドで夜間補正＋{{
                  combat.elemental.bonus[mySide]
                }}を使う
              </label>
              <button
                class="primary"
                :disabled="!!store.pending"
                @click="
                  act({
                    type: 'elementRound',
                    player: 0,
                    element: selectedElement,
                    potion: battlePotion,
                    bonus: bonusRound,
                  })
                "
              >
                属性と薬を確定
              </button>
            </template>
            <CombatRounds
              v-if="combat.elemental.rounds.length && !combat.done"
              :combat="combat"
              :sides="[mySide, 1 - mySide]"
              :names="combat.participants.map((id) => s.players[id].name)"
            />
            <template v-if="combat.done">
              <p>{{ combatReason(combat) }}</p>
              <h3>
                {{
                  combat.winner === null
                    ? "引き分け"
                    : s.players[combat.winner!].name + "の勝利"
                }}
              </h3>
              <p v-if="combat.kind === 'public'" class="combat-fp">
                <span v-for="id in combat.participants" :key="id">
                  {{ s.players[id].name }}：名声（FP）
                  {{
                    s.players[id].fp -
                    Number(combat.winner === id) * publicDuelReward(s)
                  }}
                  → {{ s.players[id].fp }} （{{
                    combat.winner === id
                      ? "+" + publicDuelReward(s)
                      : "増減なし"
                  }}）
                </span>
              </p>
              <details class="combat-details">
                <summary>戦闘の詳細を見る</summary>
                <CombatRounds
                  :combat="combat"
                  :sides="[mySide, 1 - mySide]"
                  :names="combat.participants.map((id) => s.players[id].name)"
                />
              </details>
              <button
                class="primary"
                @click="act({ type: 'combatAck', player: 0 })"
              >
                確認した
              </button>
            </template>
          </section>
          <section
            v-if="combat && !combat.elemental && myCombat"
            class="panel combat-panel"
          >
            <div class="battle-header" role="status">
              <strong
                >第
                {{
                  Math.min(
                    5,
                    combat.rounds.length +
                      Number(!combat.done && battleStep === "choose"),
                  ) || 1
                }}
                ラウンド / 最大5</strong
              >
              <span v-for="(id, side) in combat.participants" :key="id"
                >{{ id === 0 ? "あなた" : s.players[id].name }} HP
                {{ combat.hp[side]
                }}<b v-if="!combat.done && combat.charge[side] > 0">
                  · 次の攻撃・防御にためる +{{ combat.charge[side] }}</b
                ></span
              >
            </div>
            <h2>
              {{
                combat.kind === "mock"
                  ? "公開模擬戦"
                  : combat.kind === "secret"
                    ? "秘匿決闘"
                    : "公開決闘"
              }}
            </h2>
            <div class="versus">
              <template v-for="(id, side) in combat.participants" :key="id">
                <span v-if="side === 1">VS</span>
                <div :data-player="id" :data-side="side">
                  <strong>{{ s.players[id].name }}</strong
                  ><small>{{
                    side === 0 ? "仕掛けた魔女" : "仕掛けられた魔女"
                  }}</small
                  ><b>{{ combat.hp[side] }} <small>HP</small></b>
                </div>
              </template>
            </div>
            <section v-if="battleStep === 'intro'" class="battle-intro">
              <h3>対戦相手を確認</h3>
              <p>
                最大5ラウンド。HPが0になるか5ラウンド終了で決着し、残りHPが多い魔女が勝ちます。同じHPなら引き分けです。
              </p>
              <button
                class="primary"
                @click="battleStep = combat.done ? 'end' : 'choose'"
              >
                {{ combat.done ? "戦闘結果を確認" : "行動選択へ" }}
              </button>
            </section>
            <section v-if="battleStep === 'reveal' && latestRound">
              <h3>双方の行動公開</h3>
              <p>
                {{
                  revealedActions(
                    latestRound,
                    combat.participants.map((id) => s.players[id].name),
                  )
                }}
              </p>
              <button class="primary" @click="battleStep = 'judgment'">
                判定結果を見る
              </button>
            </section>
            <section v-if="battleStep === 'judgment'">
              <h3>第{{ combat.rounds.length }}ラウンドの判定結果</h3>
              <CombatRounds
                :combat="combat"
                :names="combat.participants.map((id) => s.players[id].name)"
                :only-last="true"
              />
              <button
                class="primary"
                @click="battleStep = combat.done ? 'end' : 'choose'"
              >
                {{ combat.done ? "戦闘終了へ" : "次のラウンドへ" }}
              </button>
            </section>
            <template v-if="!combat.done && battleStep === 'choose'"
              ><h3>行動選択</h3>
              <p class="muted">
                攻撃・防御・ためるを同時選択。ためる中は無防備です。洞察＋1D6（薬補正あり）を次Rの攻撃・防御へ加え、そのRで消費します。連続ためるはできません。
              </p>
              <p v-if="combat.rounds.length === 4" class="interrupt-reason">
                第5ラウンドです。ためるは選択できません。
              </p>
              <details v-if="!combat.rounds.length">
                <summary>
                  戦闘薬を持ち込む（洞察Lv{{ level(me.stats.insight) }} / 最大{{
                    level(me.stats.insight)
                  }}個）
                </summary>
                <p class="muted">
                  Lv3戦闘薬のみ選択可能。持ち込んだ薬は未使用でも終了時に消失します。
                </p>
                <label
                  v-for="i in available(me).filter(
                    (i) => recipe(i.kind)?.tier === 'combat',
                  )"
                  :key="i.id"
                  class="checkbox-row"
                  ><input v-model="brought" type="checkbox" :value="i.id" />{{
                    itemName(i.kind)
                  }}</label
                ><button
                  :disabled="
                    !can({ type: 'loadout', player: 0, items: brought }) ||
                    !brought.length
                  "
                  @click="act({ type: 'loadout', player: 0, items: brought })"
                >
                  持込を確定
                </button>
              </details>
              <CombatAffinity :elemental="false" />
              <div class="stance-options">
                <button
                  v-for="v in ['attack', 'defend', 'charge'] as Stance[]"
                  :key="v"
                  :disabled="!legalStances(combat, mySide).includes(v)"
                  :class="{ chosen: stance === v }"
                  @click="stance = v"
                >
                  {{ LABELS[v] }}
                  <small v-if="!legalStances(combat, mySide).includes(v)">{{
                    combat.rounds.length === 4
                      ? "最終ラウンドは使用不可"
                      : "連続では使用不可"
                  }}</small>
                </button>
              </div>
              <div v-if="me.magic === 'illusion'" class="illusion-status">
                <label class="checkbox-row"
                  ><input
                    type="checkbox"
                    :checked="
                      me.activeMagic &&
                      combat.kind === 'secret' &&
                      combat.initiator === 0
                    "
                    disabled
                  />幻惑を使用する（夜の確定内容）</label
                >
                <p>
                  夜の固有魔法で使用を確定し、自分から襲撃した秘匿決闘でのみ、相手の行動を1ラウンド変更します。戦闘中は変更できません。再使用まで2日。
                </p>
              </div>
              <label
                >このラウンドの薬<select v-model="battlePotion">
                  <option :value="undefined">使わない</option>
                  <option
                    v-for="i in combat.brought[mySide]"
                    :key="i.id"
                    :value="i.id"
                  >
                    {{ itemName(i.kind) }}
                  </option>
                </select></label
              ><button
                class="primary"
                :disabled="
                  !can({
                    type: 'round',
                    player: 0,
                    stance,
                    potion: battlePotion,
                  })
                "
                @click="
                  act({
                    type: 'round',
                    player: 0,
                    stance,
                    potion: battlePotion,
                  })
                "
              >
                手を確定 · 1D6を振る
              </button></template
            ><template v-if="combat.done && battleStep === 'end'"
              ><p>{{ combatReason(combat) }}</p>
              <button
                v-if="combat.kind === 'mock'"
                class="primary"
                @click="
                  mockResult = undefined;
                  battleStep = 'intro';
                "
              >
                確認した
              </button>
              <h3>
                {{
                  combat.winner === null
                    ? "引き分け"
                    : combat.winner === 0
                      ? "あなたの勝利"
                      : "あなたの敗北"
                }}
              </h3>
              <template
                v-if="
                  combat.winner === 0 &&
                  (combat.kind !== 'secret' || combat.resultAcknowledged)
                "
                ><template v-if="combat.kind === 'secret'"
                  ><button
                    @click="act({ type: 'reward', player: 0, kind: 'item' })"
                  >
                    アイテムを1個強奪</button
                  ><button
                    :disabled="s.day === 8"
                    @click="act({ type: 'reward', player: 0, kind: 'command' })"
                  >
                    翌日の1APを命令
                  </button></template
                ></template
              ></template
            >
            <details v-if="battleStep === 'choose' && combat.rounds.length">
              <summary>前のラウンドの判定を見る</summary>
              <CombatRounds
                :combat="combat"
                :names="combat.participants.map((id) => s.players[id].name)"
              />
            </details>
            <p v-if="combat.kind === 'secret'" class="muted">
              解決済みラウンドの詳細は当事者だけに表示します。
            </p>
          </section>
          <section
            v-if="
              s.phase === 'public' &&
              me.commands.length &&
              currentPlayer(s) === 0 &&
              !s.publicTurn.acted &&
              s.publicTurn.round <= 2 &&
              !combat &&
              !s.challenge
            "
            class="panel forced-panel"
          >
            <h2>
              {{
                me.commands[0].kind === "choice"
                  ? "行動制限：採集か研究を選ぶ"
                  : "先に命令のAPを実行"
              }}
            </h2>
            <p>
              残り{{
                me.commands.length
              }}件。1件につき1AP消費。報酬を選んだ魔女：{{
                me.commands.map((c) => s.players[c.from].name).join("・")
              }}。対象：{{ me.name }}。
            </p>
            <button
              class="primary"
              :disabled="!can({ type: 'forced', player: 0, kind: 'gather' })"
              @click="act({ type: 'forced', player: 0, kind: 'gather' })"
            >
              命令の採集を実行（1AP）</button
            ><select v-model="forcedStat" aria-label="命令研究の属性">
              <option v-for="k in STATS" :key="k" :value="k">
                {{ LABELS[k] }}
              </option>
            </select>
            <select
              v-if="modernNight && modifiers.research"
              v-model="researchPayment[forcedStat]"
              aria-label="命令研究の素材"
            >
              <option :value="undefined">素材を選択</option>
              <option
                v-for="kind in V20_RESEARCH[forcedStat]"
                :key="kind"
                :value="kind"
              >
                {{ itemName(kind) }}
              </option>
            </select>
            <p v-if="researchCost(forcedStat)">
              <span
                v-for="[kind, needed] in researchCost(forcedStat)"
                :key="kind"
                class="material-count"
              >
                <GameIcon :kind="kind" />{{ itemName(kind) }}：必要{{
                  needed
                }}
                / 使用可能{{ inventory[kind]?.free ?? 0 }}
              </span>
            </p>
            <ResearchPreview
              v-if="forcedResearchGrowth !== undefined"
              :growth="forcedResearchGrowth!"
              :scholarship="scholarshipActive"
              :stat="forcedStat"
              :value="me.stats[forcedStat]"
              :rules-version="s.rulesVersion"
              :recipes="me.recipes"
            />
            <button
              :disabled="
                !can({
                  type: 'forced',
                  player: 0,
                  kind: 'research',
                  stat: forcedStat,
                  material: researchPayment[forcedStat],
                })
              "
              @click="
                act({
                  type: 'forced',
                  player: 0,
                  kind: 'research',
                  stat: forcedStat,
                  material: researchPayment[forcedStat],
                })
              "
            >
              命令の研究を実行（1AP）
            </button>
          </section>
          <section
            v-if="s.phase === 'public' && !combat && !actionScreen"
            class="turn-status persistent-turn"
            role="status"
          >
            <h2>
              {{
                s.publicTurn.round <= 2
                  ? "公開行動・" + (s.publicTurn.round === 1 ? "午前" : "午後")
                  : waitingForTrades
                    ? "取引の返答待ち"
                    : "公開行動完了"
              }}
            </h2>
            <p v-if="currentPlayer(s) !== undefined">
              手番：{{ s.players[currentPlayer(s)!].name }} · 順番
              {{
                s.publicTurn.order.map((id) => s.players[id].name).join(" → ")
              }}
            </p>
            <p v-if="waitingForTrades">{{ interruptReason }}</p>
          </section>
          <section
            v-if="
              s.phase === 'public' &&
              !s.event.resolved &&
              !combat &&
              !s.challenge
            "
            class="panel actions-panel"
          >
            <div class="section-heading">
              <h2 tabindex="-1">今、何をする？</h2>
              <span class="ap-badge">残りAP {{ me.ap }} / 2</span>
            </div>
            <div role="status">
              <p v-if="s.publicTurn.round <= 2 && currentPlayer(s) === 0">
                {{ s.publicTurn.round === 1 ? "午前" : "午後" }} ·
                この時間帯の1AP行動：{{
                  s.publicTurn.acted ? "使用済み" : "未使用"
                }}
              </p>
              <p v-if="publicAPReason" id="public-ap-reason">
                {{ publicAPReason }}
              </p>
              <p v-if="s.publicTurn.acted && currentPlayer(s) === 0">
                可能な0AP操作を続けるか、手番を終了できます。
              </p>
            </div>
            <div v-if="modernNight && currentPlayer(s) === 0 && actionScreen">
              <button
                v-for="item in usable(s, me).filter(
                  (i) =>
                    i.kind ===
                    (
                      {
                        gather: 'abundance',
                        research: 'scholarship',
                        shop: 'bargaining',
                      } as Record<string, string>
                    )[actionScreen],
                )"
                :key="item.id"
                :disabled="
                  !can({ type: 'usePotion', player: 0, item: item.id })
                "
                @click="act({ type: 'usePotion', player: 0, item: item.id })"
              >
                <GameIcon :kind="item.kind" />{{
                  itemName(item.kind)
                }}を使う（0AP）
              </button>
            </div>
            <p v-if="!actionScreen" class="action-steps">
              行動を選ぶ → 内容を確認 → 確定 → 手番終了
            </p>
            <details v-if="!actionScreen" class="public-help">
              <summary>公開行動の進め方</summary>
              <p>
                午前・午後それぞれで1AP行動を1回選び、納品・取引を済ませたら「手番終了」へ。何もしないでパスすることもできます。
              </p>
            </details>
            <nav
              v-if="!actionScreen"
              class="action-menu public-action-menu"
              id="public-action-choices"
              aria-label="公開行動"
            >
              <button
                v-for="(action, id) in publicActions"
                :key="id"
                :class="{ active: tab === id }"
                :aria-describedby="
                  action.cost && publicAPReason ? 'public-ap-reason' : undefined
                "
                @click="openAction(id)"
              >
                <GameIcon :kind="action.icon" class="action-card-symbol" /><span
                  >{{ action.label }}（{{ action.cost }}AP）</span
                >
                <small v-if="action.cost && publicAPReason" class="muted">
                  {{ id === "duel" ? "1APの挑戦は不可" : "詳細のみ" }}
                </small>
              </button>
            </nav>
            <button v-if="actionScreen" @click="cancelAction">
              キャンセルして戻る
            </button>
            <p v-if="actionScreen" class="selection-summary" role="status">
              選択中：{{
                eventMockSelected
                  ? "イベント模擬戦"
                  : actionScreen === "duel"
                    ? "通常の公開決闘"
                    : publicActions[actionScreen as keyof typeof publicActions]
                        ?.label
              }}
              · 必要AP
              {{
                eventMockSelected
                  ? 0
                  : publicActions[actionScreen as keyof typeof publicActions]
                      ?.cost
              }}<template v-if="actionScreen === 'duel' && !eventMockSelected"
                >（公開決闘への挑戦時）</template
              >
            </p>
            <h3
              v-if="actionScreen && !['trade', 'event'].includes(actionScreen)"
            >
              {{
                publicActions[actionScreen as keyof typeof publicActions]?.label
              }}
            </h3>
            <template v-if="actionScreen && tab === 'field'"
              ><label v-if="!modernNight"
                >行動と同時に使う薬<select v-model="actionPotion">
                  <option :value="undefined">なし</option>
                  <option
                    v-for="i in available(me).filter(
                      (i) => recipe(i.kind)?.effect === actionScreen,
                    )"
                    :key="i.id"
                    :value="i.id"
                  >
                    {{ itemName(i.kind) }}
                  </option>
                </select></label
              >
              <details v-if="actionScreen === 'gather'">
                <summary>採集できる素材を見る</summary>
                <div class="material-roster">
                  <span v-for="kind in MATERIALS" :key="kind"
                    ><GameIcon :kind="kind" />{{ itemName(kind) }}</span
                  >
                </div>
              </details>
              <div v-if="actionScreen === 'gather'" class="action-card">
                <div>
                  <h3>森で採集</h3>
                  <p>
                    素材を基本2個、6種類から等確率で獲得。<br />今回の獲得数：{{
                      Math.max(
                        0,
                        modernNight
                          ? 2 +
                              modifiers.gather +
                              Number(!!me.publicPotions?.includes("abundance"))
                          : 2 +
                              me.rest -
                              me.curse +
                              (recipe(
                                me.inventory.find((i) => i.id === actionPotion)
                                  ?.kind ?? "",
                              )?.effect === "gather"
                                ? recipe(
                                    me.inventory.find(
                                      (i) => i.id === actionPotion,
                                    )!.kind,
                                  )!.power
                                : 0),
                      )
                    }}個
                  </p>
                </div>
                <button
                  :disabled="
                    !can({ type: 'gather', player: 0, potion: actionPotion })
                  "
                  @click="
                    act({ type: 'gather', player: 0, potion: actionPotion })
                  "
                >
                  採集 <small>1AP</small>
                </button>
              </div>
              <div
                v-for="k in actionScreen === 'research' ? STATS : []"
                :key="k"
                class="action-card research-card"
              >
                <div>
                  <h3>
                    <GameIcon :kind="k" :legacy="!isV20(s)" />{{
                      LABELS[k]
                    }}を研究
                  </h3>
                  <p v-if="researchCost(k)">
                    <span
                      v-for="[kind, needed] in researchCost(k)"
                      :key="kind"
                      class="material-count"
                    >
                      <GameIcon :kind="kind" />{{ itemName(kind) }}：必要{{
                        needed
                      }}
                      / 使用可能{{ inventory[kind]?.free ?? 0 }}
                    </span>
                  </p>
                  <p v-else>
                    {{
                      modifiers.research > 0 ? "追加素材" : "支払う素材"
                    }}を選ぶと必要数を表示します。
                  </p>
                  <ResearchPreview
                    v-if="researchGrowthByStat[k] !== undefined"
                    :growth="researchGrowthByStat[k]!"
                    :scholarship="scholarshipActive"
                    :stat="k"
                    :value="me.stats[k]"
                    :rules-version="s.rulesVersion"
                    :recipes="me.recipes"
                  />
                  <details class="research-attribute-details">
                    <summary>現在の効果と次のLv</summary>
                    <AttributeDetails
                      :label="LABELS[k]"
                      :stat="k"
                      :value="me.stats[k]"
                      :rules-version="s.rulesVersion"
                      :recipes="me.recipes"
                    />
                  </details>
                </div>
                <label v-if="modernNight && modifiers.research"
                  >{{ modifiers.research > 0 ? "追加素材" : "支払う素材" }}
                  <select v-model="researchPayment[k]">
                    <option :value="undefined">素材を選択</option>
                    <option
                      v-for="kind in V20_RESEARCH[k]"
                      :key="kind"
                      :value="kind"
                    >
                      {{ itemName(kind) }}
                    </option>
                  </select>
                </label>
                <button
                  :disabled="
                    !can({
                      type: 'research',
                      player: 0,
                      stat: k,
                      material: researchPayment[k],
                      potion: actionPotion,
                    })
                  "
                  @click="
                    act({
                      type: 'research',
                      player: 0,
                      stat: k,
                      material: researchPayment[k],
                      potion: actionPotion,
                    })
                  "
                >
                  研究 <small>1AP</small>
                </button>
              </div></template
            >
            <template v-if="actionScreen && tab === 'event'">
              <EventOverview :state="s" />
              <h3>この協力イベントに仮納品する（0AP）</h3>
              <p class="reservation-limit">
                {{
                  `予約済み ${reservationUnits(s, me)}。超過分は結果確定時に返却します。`
                }}
              </p>
              <details>
                <summary>納品の消費・返却ルール</summary>
                <p>納品は0AP。成功時のみ消費し、失敗時は返却します。</p>
              </details>
              <GroupedItems
                v-model="selected"
                :items="donationCandidates"
                purpose="仮納品する数"
              />
              <div v-if="event?.stats" class="stat-inputs">
                <label v-for="k in STATS" :key="k"
                  ><GameIcon :kind="k" :legacy="!isV20(s)" />{{
                    LABELS[k]
                  }}（能力値{{ me.stats[k] }}／納品可能{{
                    me.stats[k] - 1
                  }}点）<QuantitySpinner :label="LABELS[k] + 'の納品数'"
                    ><input
                      v-model.number="reserveStats[k]"
                      :aria-label="LABELS[k] + 'の納品数'"
                      type="number"
                      inputmode="numeric"
                      step="1"
                      min="0"
                      :max="me.stats[k] - 1"
                      placeholder="0" /></QuantitySpinner
                ></label>
              </div>
              <div class="delivery-actions">
                <button
                  class="primary"
                  :disabled="
                    (!selected.length &&
                      !Object.values(reserveStats).some((n) => n)) ||
                    !can({
                      type: 'reserve',
                      player: 0,
                      items: selected,
                      stats: reserveStats,
                    })
                  "
                  @click="
                    act({
                      type: 'reserve',
                      player: 0,
                      items: selected,
                      stats: reserveStats,
                    });
                    reserveStats = {};
                  "
                >
                  仮納品する（0AP）
                </button>
                <button @click="act({ type: 'withdraw', player: 0 })">
                  自分の予約をすべて撤回（0AP）
                </button>
              </div>
              <p v-if="reserveReason" class="operation-reason" role="status">
                {{ uiText(reserveReason) }}
              </p>
            </template>
            <template v-if="actionScreen && tab === 'shop'">
              <p class="muted">
                任意の素材{{ 3 + (modernNight ? modifiers.shop : 0) }}個 →
                指定素材1個
              </p>
              <GroupedItems
                v-model="selected"
                :items="available(me).filter((i) => MATERIALS.includes(i.kind))"
              />
              <GameIcon :kind="shopKind" />
              <select v-model="shopKind">
                <option v-for="m in MATERIALS" :key="m" :value="m">
                  {{ itemName(m) }}
                </option></select
              ><button
                :disabled="
                  !can({
                    type: 'shop',
                    player: 0,
                    items: selected,
                    receive: shopKind,
                  })
                "
                @click="
                  act({
                    type: 'shop',
                    player: 0,
                    items: selected,
                    receive: shopKind,
                  })
                "
              >
                {{ 3 + (modernNight ? modifiers.shop : 0) }}個を交換（1AP）
              </button>
            </template>
            <template v-if="actionScreen && tab === 'trade'">
              <h3>魔女間取引 <span class="tag">成立・拒否とも0AP</span></h3>
              <label
                >相手<select v-model="target">
                  <option
                    v-for="p in s.players.slice(1)"
                    :key="p.id"
                    :value="p.id"
                  >
                    {{ p.name }}
                  </option>
                </select></label
              >
              <details>
                <summary>自分が渡す数・相手から受け取る数を入力</summary>
                <div class="trade-row">
                  <span>品目・自分の所持数</span
                  ><span>自分 → 相手<br />渡す数</span
                  ><span>相手 → 自分<br />受け取る数</span>
                </div>
                <div
                  v-for="kind in [
                    ...MATERIALS,
                    ...NIGHT_RECIPES.map((r) => r.id),
                  ]"
                  :key="kind"
                  class="trade-row"
                >
                  <span
                    ><GameIcon :kind="kind" />{{ itemName(kind)
                    }}<small class="inventory-caption"
                      >所持 {{ inventory[kind]?.total ?? 0 }}個 · 提供可能
                      {{ inventory[kind]?.free ?? 0 }}個</small
                    ></span
                  ><label class="trade-quantity"
                    ><span>自分が渡す数</span
                    ><QuantitySpinner :label="itemName(kind) + ' 提供数'"
                      ><input
                        v-model.number="tradeOffer[kind]"
                        type="number"
                        inputmode="numeric"
                        step="1"
                        min="0"
                        :max="inventory[kind]?.free ?? 0"
                        :aria-label="`${itemName(kind)} 提供数`"
                        placeholder="0" /></QuantitySpinner></label
                  ><label class="trade-quantity"
                    ><span>相手から受け取る数</span
                    ><QuantitySpinner :label="itemName(kind) + ' 要求数'"
                      ><input
                        v-model.number="tradeRequest[kind]"
                        type="number"
                        inputmode="numeric"
                        step="1"
                        min="0"
                        :aria-label="`${itemName(kind)} 要求数`"
                        placeholder="0" /></QuantitySpinner
                  ></label>
                </div>
              </details>
              <div class="selection-summary trade-preview" aria-live="polite">
                <h4>提案内容の確認：あなた ↔ {{ s.players[target].name }}</h4>
                <p>あなたが渡す：{{ describeTrade(tradeOffer) }}</p>
                <p>
                  {{ s.players[target].name }}から受け取る：{{
                    describeTrade(tradeRequest)
                  }}
                </p>
                <p v-if="tradePreview.reason" class="operation-reason">
                  提案できない理由：{{ uiText(tradePreview.reason) }}
                </p>
              </div>
              <button :disabled="!!tradePreview.reason" @click="offer">
                固定条件で提案（0AP）
              </button>
              <p class="muted">
                所持品の内訳は非公開です。提案では品を予約せず、承諾時に確認します。片側0個の譲渡も可能です。
              </p></template
            >
            <template v-if="actionScreen && tab === 'duel'">
              <p
                v-if="eventMockSelected"
                class="event-mock-notice"
                role="status"
              >
                イベント模擬戦を選択中（0AP）。相手を選び「イベント模擬戦」で確定してください。
              </p>
              <p v-else class="public-duel-notice" role="status">
                通常の公開決闘を選択中（1AP）。イベント模擬戦の達成条件には数えません。
              </p>
              <label
                >対戦相手<select v-model="target">
                  <option :value="-1" disabled>
                    対戦相手を選択してください
                  </option>
                  <option
                    v-for="p in s.players.slice(1)"
                    :key="p.id"
                    :value="p.id"
                  >
                    {{ p.name }}
                  </option>
                </select></label
              >
              <p v-if="eventMockSelected">
                イベント模擬戦は0APで、通常の公開決闘とは別の操作です。
              </p>
              <p v-else>
                公開決闘：挑戦者1AP、被挑戦者0AP。勝者FP+{{
                  publicDuelReward(s)
                }}、能力移転なし。挑戦側・被挑戦側のどちらが勝っても同じFP報酬です。<br />模擬戦：イベント用。勝敗は達成条件に影響しません。
              </p>
              <p
                class="muted"
                v-if="
                  !eventMockSelected && s.rulesVersion === V20_RULES_VERSION
                "
              >
                公開決闘の勝利報酬：1〜4日目＋1FP／5〜8日目＋2FP。秘匿戦闘には適用しません。
              </p>
              <p class="muted" v-else-if="!eventMockSelected">
                このセーブの公開決闘勝利報酬は全日＋1FPです。秘匿戦闘には適用しません。
              </p>
              <div class="duel-actions">
                <button
                  v-if="!eventMockSelected"
                  :disabled="!can({ type: 'duel', player: 0, target })"
                  @click="
                    !eventMockSelected &&
                    act({ type: 'duel', player: 0, target })
                  "
                >
                  公開決闘 <small>1AP</small></button
                ><button
                  v-else
                  class="primary"
                  :disabled="
                    !can({ type: 'duel', player: 0, target, mock: true })
                  "
                  @click="
                    eventMockSelected &&
                    act({ type: 'duel', player: 0, target, mock: true })
                  "
                >
                  イベント模擬戦 <small>0AP</small>
                </button>
              </div>
              <div class="duel-mode-switch">
                <small
                  >切り替えだけでは消費しません。確定時は通常決闘1AP／イベント模擬戦0APです。</small
                >
                <button
                  type="button"
                  v-if="eventMockSelected"
                  @click="switchDuelMode(false)"
                >
                  通常の公開決闘に切り替える
                </button>
                <button
                  type="button"
                  v-else-if="event?.mock && !s.event.mock.length"
                  @click="switchDuelMode(true)"
                >
                  イベント模擬戦に切り替える
                </button>
                <p v-if="target === -1" role="status">
                  種別を切り替えました。対戦相手を選び直してから確定してください。
                </p>
              </div></template
            >
          </section>
          <section
            v-if="s.phase === 'magic' && !combat && !s.challenge"
            class="panel"
          >
            <p class="eyebrow">固有魔法</p>
            <h2>今夜、固有魔法を使いますか？</h2>
            <h3>{{ MAGICS[me.magic].name }}</h3>
            <p>
              {{
                hasRevisedNightRules(s) && me.magic === "foresight"
                  ? "翌日の候補から、予知を使った魔女が1枚選びます。第1〜7日。"
                  : MAGICS[me.magic].description
              }}
            </p>
            <label v-if="me.magic === 'barrier'"
              >保護対象<select v-model="target">
                <option v-for="p in s.players" :key="p.id" :value="p.id">
                  {{ p.name }}
                </option>
              </select></label
            ><label v-if="me.magic === 'illusion'" class="checkbox-row"
              ><input
                v-model="illusionPlanned"
                type="checkbox"
                :disabled="me.activeMagic"
              />幻惑を使用する</label
            ><button
              :disabled="
                !can({ type: 'magic', player: 0, target }) ||
                (me.magic === 'illusion' && !illusionPlanned)
              "
              @click="act({ type: 'magic', player: 0, target })"
            >
              自分の{{ MAGICS[me.magic].name }}を使う
              <small>再使用まで {{ MAGICS[me.magic].cd }}日</small>
            </button>
            <p v-if="me.activeMagic" class="mint">使用を確定しました。</p>
            <p class="muted">使用せずに次へ進むこともできます。</p>
          </section>
          <section
            v-if="
              s.phase === 'vote' &&
              (modernNight || (me.activeMagic && me.magic === 'foresight'))
            "
            class="panel"
          >
            <h2>
              {{
                hasRevisedNightRules(s)
                  ? "予知 · 明日のイベントを選ぶ"
                  : "予知の投票 · 明日のイベントを選ぶ"
              }}
            </h2>
            <p v-if="me.magic !== 'foresight' || !me.activeMagic">
              他の魔女の予知で出た候補です。あなたは投票だけ行います。
            </p>
            <button
              v-for="id in s.foresight"
              :key="id"
              :disabled="s.votes[0] !== undefined"
              :class="{ chosen: s.votes[0] === id }"
              @click="act({ type: 'vote', player: 0, event: id })"
            >
              {{ EVENTS[id - 1].name }}（{{ EVENTS[id - 1].difficulty }}）
            </button>
            <p class="muted">匿名投票で決定。同票は抽選します。</p>
          </section>
          <section
            v-if="s.phase === 'night' && modernNight"
            class="panel night-panel"
          >
            <h2>夜間行動と錬金</h2>
            <template v-if="!me.night">
              <p class="night-step">
                1.
                夜間行動と錬金を選び、下のボタンで確定してください。確定後は変更できません。
              </p>
              <div class="action-menu" role="group" aria-label="夜間行動">
                <button
                  v-for="kind in NIGHT_ACTIONS"
                  :key="kind"
                  type="button"
                  :class="{ active: night === kind }"
                  :aria-pressed="night === kind"
                  :disabled="kind === 'raid' && me.lastRaid === s.day - 1"
                  @click="night = kind"
                >
                  <GameIcon :kind="nightActionIcons[kind]" />{{ LABELS[kind] }}
                </button>
              </div>
              <p class="night-effect">{{ nightEffect }}</p>
              <p class="muted">
                能力値6でLv2、9でLv3。火・水・風は対応する戦闘属性のダメージがLvごとに＋1。風Lvを上げると新しい錬金レシピも解禁されます。
              </p>
              <label v-if="['raid', 'scout', 'curse'].includes(night)"
                >対象
                <select v-model="target">
                  <option
                    v-for="p in s.players.slice(1)"
                    :key="p.id"
                    :value="p.id"
                  >
                    {{ p.name }}
                  </option>
                </select>
              </label>
              <h3>錬金（夜間行動とは別枠）</h3>
              <label
                >レシピ
                <select v-model="nightRecipe">
                  <option
                    v-for="r in NIGHT_RECIPES"
                    :key="r.id"
                    :value="r.id"
                    :disabled="!me.recipes.includes(r.id)"
                  >
                    {{ r.name }}（{{ r.materials.map(itemName).join("＋")
                    }}{{ me.recipes.includes(r.id) ? "" : "・未解放" }}）
                  </option>
                </select>
              </label>
              <p v-if="modernRecipe(nightRecipe)" class="recipe-preview">
                <GameIcon :kind="nightRecipe" />
                {{ NIGHT_RECIPE_EFFECTS[nightRecipe] }}
              </p>
              <details>
                <summary>すべての薬の効果</summary>
                <ul>
                  <li v-for="r in NIGHT_RECIPES" :key="r.id">
                    <strong><GameIcon :kind="r.id" />{{ r.name }}</strong> —
                    {{ NIGHT_RECIPE_EFFECTS[r.id] }}
                  </li>
                </ul>
              </details>
              <button
                :disabled="!me.recipes.includes(nightRecipe)"
                @click="nightPlan.push(nightRecipe)"
              >
                作成予定に追加
              </button>
              <p v-for="(id, i) in nightPlan" :key="i">
                <GameIcon :kind="id" />{{ itemName(id) }}
                <button @click="nightPlan.splice(i, 1)">削除</button>
              </p>
              <p v-if="actionError(nightDraft)" class="muted">
                {{ actionError(nightDraft) }}
              </p>
              <button
                class="primary"
                :disabled="!can(nightDraft)"
                @click="act(nightDraft)"
              >
                夜間行動と錬金を確定
              </button>
              <p class="muted">
                錬金を行わない場合も、夜間行動を選んで確定してください。
              </p>
            </template>
            <div
              v-else
              class="night-confirmation"
              role="region"
              aria-label="夜間行動の確定状況"
            >
              <h3>2. あなたの行動は確定済みです</h3>
              <p>
                {{ LABELS[me.night.kind] }}と錬金計画（{{
                  me.night.recipes?.length ?? 0
                }}個）を確定しました。変更はできません。
              </p>
              <ul>
                <li v-for="p in nightStatus?.confirmations" :key="p.id">
                  {{ p.name }}：{{ p.confirmed ? "確定済み" : "確定待ち" }}
                </li>
              </ul>
              <p v-if="!nightStatus?.allConfirmed" role="status">
                他の魔女の確定を待っています。行動内容は公開されません。
              </p>
              <template v-else>
                <p>全員の行動が確定しました。夜間行動と錬金を解決します。</p>
                <button
                  class="primary"
                  :disabled="!nightStatus?.canResolve"
                  @click="resolveNight"
                >
                  秘匿行動を解決 →
                </button>
              </template>
            </div>
          </section>
          <section v-if="modernReward?.winner === 0" class="panel night-reward">
            <h2>夜間の報酬を選ぶ</h2>
            <p>相手：{{ modernReward.loser.name }}</p>
            <template v-if="hasRevisedNightRules(s)">
              <button
                :disabled="!modernReward.items.length || !!store.pending"
                @click="
                  act({ type: 'nightReward', player: 0, randomLoot: true })
                "
              >
                アイテムを強奪（ランダムに1個）
              </button>
              <button
                :disabled="!modernReward.canCommand || !!store.pending"
                @click="
                  act({ type: 'nightReward', player: 0, command: 'choice' })
                "
              >
                翌日の行動を制限
              </button>
              <p>
                行動制限を受けた魔女は、次の手番で採集か研究を選びます。夜間決闘の勝利によるFP加算はありません。
              </p>
            </template>
            <template v-else>
              <button
                v-for="item in modernReward.items"
                :key="item.id"
                :disabled="!!store.pending"
                @click="act({ type: 'nightReward', player: 0, item: item.id })"
              >
                <GameIcon :kind="item.kind" />強奪：{{ itemName(item.kind) }}
              </button>
              <template v-if="modernReward.canCommand">
                <button
                  :disabled="!!store.pending"
                  @click="
                    act({ type: 'nightReward', player: 0, command: 'gather' })
                  "
                >
                  翌日の採集を命令
                </button>
                <button
                  :disabled="!!store.pending"
                  @click="
                    act({ type: 'nightReward', player: 0, command: 'research' })
                  "
                >
                  翌日の研究を命令
                </button>
              </template>
            </template>
          </section>
          <section
            v-if="s.phase === 'night' && !modernNight"
            class="panel night-panel"
          >
            <p class="eyebrow">秘匿行動</p>
            <h2>秘密の行動をひとつ。</h2>
            <div v-if="!actionScreen || me.night" class="night-options">
              <button
                v-for="n in [
                  'raid',
                  'curse',
                  'guard',
                  'rest',
                  'brew',
                  'scout',
                ] as NightKind[]"
                :key="n"
                :class="{ chosen: night === n }"
                :disabled="!!me.night"
                @click="
                  openAction(n);
                  night = n;
                  nightPotion = undefined;
                  if (target === 0) target = 1;
                "
              >
                <GameIcon :kind="nightActionIcons[n]" />{{ LABELS[n] }}
              </button>
            </div>
            <button v-if="actionScreen && !me.night" @click="cancelAction">
              キャンセルして戻る
            </button>
            <template v-if="actionScreen || me.night">
              <h3>{{ LABELS[night] }} · 消費APなし</h3>
              <p class="muted">
                {{
                  {
                    raid: "対象と秘匿決闘。連夜の襲撃も可能です。",
                    curse: `対象の翌公開最初のAP行動に −${level(me.stats.attack)}。`,
                    guard: `襲撃された戦闘の初回判定に +${level(me.stats.defense)}。`,
                    rest: `今夜の全決闘に勝つか、決闘なしなら翌日の採集・研究 +${CONFIG.rest[level(me.stats.defense) - 1]}。`,
                    brew: "素材・レシピ条件の範囲で複数の薬を作成。この夜の他の秘匿行動は選択できません。",
                    scout:
                      "相手の夜行動が襲撃・警戒ならFP−1。それ以外はアイテム確認。",
                  }[night]
                }}
              </p>
              <label v-if="['raid', 'curse', 'scout'].includes(night)"
                >対象<select
                  v-model="target"
                  aria-label="対象"
                  :disabled="!!me.night"
                >
                  <option
                    v-for="p in s.players.slice(1)"
                    :key="p.id"
                    :value="p.id"
                  >
                    {{ p.name }}
                  </option>
                </select></label
              ><label v-if="night === 'brew'"
                >レシピ<select
                  v-model="nightRecipe"
                  aria-label="レシピ"
                  :disabled="!!me.night"
                >
                  <option v-for="r in RECIPES" :key="r.id" :value="r.id">
                    {{ r.name }}（{{ r.materials.map(itemName).join("＋") }}）
                  </option>
                </select></label
              >
              <div v-if="night === 'brew'">
                <section
                  v-if="recipe(nightRecipe)"
                  class="recipe-preview"
                  aria-label="選択した薬の詳細"
                >
                  <h3>
                    <GameIcon :kind="nightRecipe" />{{
                      recipe(nightRecipe)!.name
                    }}
                  </h3>
                  <p>{{ potionDescription(nightRecipe) }}</p>
                  <p
                    v-for="kind in [...new Set(recipe(nightRecipe)!.materials)]"
                    :key="kind"
                    class="material-count"
                  >
                    <GameIcon :kind="kind" />{{
                      itemName(kind)
                    }}：1個作成に必要{{
                      recipe(nightRecipe)!.materials.filter((m) => m === kind)
                        .length
                    }}個 / 現在の所持数{{ inventory[kind]?.total ?? 0 }}個
                  </p>
                </section>
                <table class="brew-materials">
                  <caption>
                    素材の所持数と作成予定
                  </caption>
                  <thead>
                    <tr>
                      <th>素材</th>
                      <th>所持数</th>
                      <th>予定消費数</th>
                      <th>追加使用可能数</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="m in brewMaterials"
                      :key="m.kind"
                      :data-material="m.kind"
                    >
                      <th><GameIcon :kind="m.kind" />{{ itemName(m.kind) }}</th>
                      <td>{{ m.owned }}</td>
                      <td>{{ m.planned }}</td>
                      <td>
                        {{ m.available
                        }}<small v-if="m.reserved"
                          >（予約中{{ m.reserved }}個を除く）</small
                        >
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p>
                  追加使用可能数は所持数から作成予定の消費数を引いた数です。予約中の素材がある場合は、その分も除きます。
                </p>
                <p v-if="brewReason" role="status" class="operation-reason">
                  {{ brewReason }}
                </p>
                <button
                  :disabled="
                    !!me.night ||
                    !brewCandidates.some((r) => r.id === nightRecipe)
                  "
                  @click="nightPlan.push(nightRecipe)"
                >
                  作成予定に追加
                </button>
                <p v-for="(id, i) in nightPlan" :key="i">
                  <GameIcon :kind="id" />{{ itemName(id) }}
                  <button
                    :disabled="!!me.night"
                    @click="nightPlan.splice(i, 1)"
                  >
                    削除
                  </button>
                </p>
                <p>作成予定 {{ nightPlan.length }} 個（固定上限なし）</p>
                <p v-if="!me.night && !brewCandidates.length">
                  現在の所持素材で追加作成可能なレシピはありません。
                </p>
              </div>
              <label v-if="['guard', 'scout'].includes(night)"
                >同時に使う薬<select
                  v-model="nightPotion"
                  :disabled="!!me.night"
                >
                  <option :value="undefined">なし</option>
                  <option
                    v-for="i in available(me).filter(
                      (i) => recipe(i.kind)?.effect === night,
                    )"
                    :key="i.id"
                    :value="i.id"
                  >
                    {{ itemName(i.kind) }}
                  </option>
                </select></label
              ><button
                class="primary"
                :disabled="
                  !can({
                    type: 'night',
                    player: 0,
                    choice: {
                      kind: night,
                      target,
                      recipes: night === 'brew' ? [...nightPlan] : undefined,
                      potion: nightPotion,
                    },
                  })
                "
                @click="
                  act({
                    type: 'night',
                    player: 0,
                    choice: {
                      kind: night,
                      target,
                      recipes: night === 'brew' ? [...nightPlan] : undefined,
                      potion: nightPotion,
                    },
                  })
                "
              >
                {{ me.night ? "行動を確定しました" : "秘匿行動を確定" }}
              </button>
              <p v-if="me.night" class="operation-reason">
                この夜の行動は確定済みです。別の行動は選択できません。
              </p>
            </template>
            <p class="muted">未選択で進めると休息します。</p>
          </section>
          <section
            v-if="dawnSummary"
            class="panel dawn-summary"
            aria-label="夜明けのまとめ"
          >
            <h2>課題判定・夜明け</h2>
            <p class="eyebrow">第{{ dawnSummary.day }}日のまとめ</p>
            <section class="review-section" aria-label="課題判定">
              <h3>
                今日の課題：{{ dawnSummary.task.achieved ? "成功" : "失敗" }}
              </h3>
              <p>
                {{
                  goalDescription(
                    {
                      id: dawnSummary.task.id,
                      targets: [],
                      achieved: dawnSummary.task.achieved,
                    },
                    false,
                  ).name
                }}
              </p>
              <h3>卒業課題：{{ goalDescription(me.longGoal, true).name }}</h3>
              <p>{{ goalDescription(me.longGoal, true).condition }}</p>
              <ul>
                <li v-for="line in graduationProgress(s)" :key="line">
                  {{ line }}
                </li>
              </ul>
            </section>
            <section class="review-section" aria-label="夜間行動の結果">
              <h3>夜間行動の結果</h3>
              <ul v-if="dawnSummary.actions.length">
                <li v-for="entry in dawnSummary.actions" :key="entry.seq">
                  {{ uiText(entry.text) }}
                </li>
              </ul>
              <p v-else>判定結果の通知なし</p>
            </section>
            <p v-if="dawnSummary.error" role="status">
              {{ dawnSummary.error }}
            </p>
            <template v-else>
              <section class="review-section" aria-label="持ち物の増減">
                <h3>持ち物の増減（1日全体）</h3>
                <ul v-if="dawnSummary.items.length">
                  <li v-for="(row, index) in dawnSummary.items" :key="index">
                    {{ row.cause }}：{{ itemName(row.kind) }}
                    {{ row.amount > 0 ? "+" : "" }}{{ row.amount }}個
                  </li>
                </ul>
                <p v-else>増減なし</p>
                <h4>品物ごとの開始・終了・差引</h4>
                <ul>
                  <li v-for="(amount, kind) in dawnSummary.totals" :key="kind">
                    {{ itemName(String(kind)) }}：{{
                      dawnSummary.inventoryStart[kind] ?? 0
                    }}
                    → {{ dawnSummary.inventoryEnd[kind] ?? 0 }}個（差引
                    {{ amount > 0 ? "+" : "" }}{{ amount }}個）
                  </li>
                </ul>
              </section>
              <section class="review-section" aria-label="名声の増減">
                <h3>名声（FP）の増減</h3>
                <ul v-if="dawnSummary.fpEntries.length">
                  <li v-for="row in dawnSummary.fpEntries" :key="row.seq">
                    {{ row.cause }}：{{ row.amount > 0 ? "+" : ""
                    }}{{ row.amount }} FP
                  </li>
                </ul>
                <p v-else>増減なし</p>
                <p>
                  本日の合計：{{
                    dawnSummary.fpEnd - dawnSummary.fpStart > 0 ? "+" : ""
                  }}{{ dawnSummary.fpEnd - dawnSummary.fpStart }} FP（{{
                    dawnSummary.fpStart
                  }}
                  → {{ dawnSummary.fpEnd }}）
                </p>
              </section>
            </template>
            <button
              v-if="s.phase === 'dawn'"
              class="primary"
              :disabled="!!store.pending || me.pendingRecipe"
              @click="next"
            >
              次の日へ →
            </button>
          </section>
          <section
            v-if="
              ['duels', 'results', 'ho'].includes(s.phase) &&
              !combat &&
              !s.challenge
            "
            class="panel phase-message"
          >
            <span class="large-star">✧</span>
            <h2>
              {{
                {
                  duels: "闇の中で、研究は続く。",
                  results: "夜の出来事を振り返る",
                  ho: "課題判定・夜明け",
                }[s.phase as "duels"]
              }}
            </h2>
            <p>下の進行ボタンで結果を確定します。</p>
          </section>
          <section
            v-if="
              s.phase !== 'ended' &&
              (!s.event.resolved || modernNight) &&
              s.phase !== 'rewards' &&
              !combat &&
              !s.challenge &&
              !actionScreen &&
              !dawnSummary &&
              !(s.phase === 'night' && modernNight)
            "
            class="panel progression"
          >
            <div>
              <strong>{{ LABELS[s.phase] }}</strong>
              <p class="muted">
                {{
                  s.phase === "public"
                    ? "納品・取引は0AP。手番終了後、AIは自動進行します。"
                    : "準備ができたら、研究を進めましょう。"
                }}
              </p>
            </div>
            <button
              class="primary"
              :disabled="
                waitingForTrades ||
                me.pendingRecipe ||
                !!s.combat ||
                !!s.challenge ||
                !!store.pending ||
                (s.phase === 'public' &&
                  s.publicTurn.round <= 2 &&
                  currentPlayer(s) !== 0)
              "
              @click="next"
            >
              {{ nextLabel }} →
            </button>
          </section>
          <details
            v-if="s.phase !== 'public' && !combat"
            class="panel event-archive"
          >
            <summary>共通イベントの履歴</summary>
            <article
              v-for="l in s.logs.filter((l) => l.type === 'eventResult')"
              :key="l.seq"
            >
              <h3>第{{ l.day }}日：{{ uiText(logText(l)) }}</h3>
              <p>{{ EVENTS[Number(l.data?.event) - 1]?.description }}</p>
            </article>
          </details>
          <details
            v-if="publicHistory.length && !combat && !actionScreen"
            class="panel public-history"
            :open="s.phase === 'public' && !combat"
          >
            <summary>この日の公開行動（実行順・自分のペースで確認）</summary>
            <ol class="log-scroll">
              <li
                v-for="l in publicHistory"
                :key="l.seq"
                :data-public-seq="l.seq"
              >
                {{
                  l.type === "win"
                    ? `${s.players[l.actor!].name}：${uiText(logText(l))}`
                    : uiText(logText(l))
                }}
                <small v-if="l.type === 'turnEnd'">
                  · 残AP {{ l.data?.remainingAP }}</small
                >
              </li>
            </ol>
            <p class="muted">
              自動進行でも履歴は消えません。過去の日の行動も研究日誌から確認できます。
            </p>
          </details>
          <section
            v-if="
              !hasRevisedNightRules(s) &&
              ['results', 'ho', 'dawn', 'ended'].includes(s.phase) &&
              !combat
            "
            class="panel results-summary"
          >
            <h2>夜の結果・1日のまとめ</h2>
            <p>
              今日の課題「{{ goalDescription(me.dailyGoal, false).name }}」：{{
                hoProgress?.status
              }}<span v-if="me.dailyGoal.achieved">
                · 今日の課題達成！ FP+1</span
              >
            </p>
            <p v-for="l in personalResults" :key="l.seq">
              {{ uiText(logText(l)) }}
            </p>
            <p v-for="l in nightResults" :key="l.seq">
              {{ uiText(logText(l)) }}
            </p>
          </section>
          <details v-if="history.length && !combat" class="panel">
            <summary>対戦の履歴（秘匿決闘は本人参加分のみ）</summary>
            <article v-for="c in history" :key="c.id" :data-combat-id="c.id">
              <h3>
                {{
                  c.participants.map((id) => s.players[id].name).join(" vs ")
                }}
                ·
                {{
                  c.kind === "mock"
                    ? "模擬戦"
                    : c.winner === null
                      ? "引分"
                      : s.players[c.winner!].name + "勝利"
                }}
              </h3>
              <CombatRounds
                :combat="c"
                :names="c.participants.map((id) => s.players[id].name)"
              />
            </article>
          </details>
        </main>
        <aside v-if="!combat && !actionScreen" class="right-column">
          <details class="panel journal">
            <summary>研究日誌を開く</summary>
            <div class="section-heading">
              <h2>研究日誌</h2>
              <small>行動と結果の記録</small>
            </div>
            <p class="muted">
              実行順の公開履歴とあなたへの個人通知。全日分を保持します。
            </p>
            <div
              class="log-scroll"
              aria-live="polite"
              aria-relevant="additions"
            >
              <article
                v-for="l in visibleLogs"
                :key="l.seq"
                :data-log-seq="l.seq"
                class="log-entry"
                :class="{ private: l.audience !== 'public' }"
              >
                <div>
                  <span>DAY {{ l.day }} · {{ LABELS[l.phase] }}</span
                  ><small v-if="l.audience !== 'public'">個人通知</small>
                </div>
                <p>{{ uiText(logText(l)) }}</p>
              </article>
            </div>
          </details>
          <section
            v-for="t in s.trades.filter((t) => t.from === 0)"
            :key="t.id"
            class="panel"
          >
            <h3>
              取引提案：{{ s.players[t.from].name }} →
              {{ s.players[t.to].name }}
            </h3>
            <p>自分が渡す：{{ describeTrade(t.offeredKinds ?? {}) }}</p>
            <p>
              相手から受け取る：{{
                Object.entries(t.request)
                  .map(([k, n]) => `${itemName(k)} ×${n}`)
                  .join("・") || "なし"
              }}
            </p>
            <template v-if="t.to === 0"
              ><button
                @click="
                  act({ type: 'tradeReply', player: 0, id: t.id, accept: true })
                "
              >
                受諾</button
              ><button
                @click="
                  act({
                    type: 'tradeReply',
                    player: 0,
                    id: t.id,
                    accept: false,
                  })
                "
              >
                拒否
              </button></template
            ><button
              v-else
              @click="act({ type: 'tradeCancel', player: 0, id: t.id })"
            >
              撤回
            </button>
          </section>
          <section class="panel developer-toggle">
            <label class="checkbox-row"
              ><input v-model="debug" type="checkbox" />開発者モード</label
            >
            <p class="muted">切り替えると全員の秘密情報を表示します。</p>
          </section>
        </aside>
      </div>
      <section v-if="debug" class="panel debug">
        <h2>開発者モード · 秘密情報を含む</h2>
        <label>現在の乱数シード<input :value="s.seed" readonly /></label>
        <button type="button" @click="copySeed">シードをコピー</button>
        <p>
          RNG draws: {{ s.draws }} / day: {{ s.day }} / phase: {{ s.phase }} /
          revision: {{ s.revision }} / {{ s.rulesVersion }}
        </p>
        <details>
          <summary>AIの行動理由・乱数監査・勝敗の根拠</summary>
          <pre>{{
            JSON.stringify(
              s.logs.filter(
                (l) =>
                  l.audience === "dev" ||
                  ["end", "dailyHO", "win"].includes(l.type),
              ),
              null,
              2,
            )
          }}</pre>
        </details>
        <details>
          <summary>全プレイヤーの状態JSON</summary>
          <pre>{{ JSON.stringify(s, null, 2) }}</pre>
        </details>
      </section>
    </template>
    <BlockingDialog
      v-if="challengeNotice && s?.challenge"
      :title="
        s.players[s.challenge.from].name +
        'から' +
        (s.challenge.mock ? '模擬戦' : '公開決闘') +
        'の挑戦'
      "
    >
      <p>
        {{
          s.challenge.mock
            ? "模擬戦を受けるか辞退してください。"
            : "対戦を受けるか、降参品を1個提示できます。"
        }}
      </p>
      <template v-if="s.challenge.surrenderItem !== undefined">
        <p>
          降参の提示：{{
            itemName(
              s.players[s.challenge.to].inventory.find(
                (item) => item.id === s.challenge!.surrenderItem,
              )?.kind ?? "",
            )
          }}
        </p>
        <button
          @click="act({ type: 'surrenderReply', player: 0, accept: true })"
        >
          降参を受け入れる
        </button>
        <button
          @click="act({ type: 'surrenderReply', player: 0, accept: false })"
        >
          断って対戦する
        </button>
      </template>
      <template v-else>
        <GroupedItems
          v-if="!s.challenge.mock"
          v-model="selected"
          :items="available(me)"
        />
        <button
          class="primary"
          @click="act({ type: 'challengeReply', player: 0, fight: true })"
        >
          対戦する</button
        ><button
          :disabled="
            !can({
              type: 'challengeReply',
              player: 0,
              fight: false,
              items: selected,
            })
          "
          @click="
            act({
              type: 'challengeReply',
              player: 0,
              fight: false,
              items: selected,
            })
          "
        >
          {{ s.challenge.mock ? "辞退" : "素材か薬を1個提示して降参" }}
        </button>
      </template>
    </BlockingDialog>
    <BlockingDialog
      v-if="tradeNotice"
      :title="s.players[tradeNotice.from].name + 'からの取引提案'"
    >
      <p>
        相手から受け取る：{{ describeTrade(tradeNotice.offeredKinds ?? {}) }}
      </p>
      <p>自分が渡す：{{ describeTrade(tradeNotice.request) }}</p>
      <template #actions>
        <button
          class="primary"
          @click="
            act({
              type: 'tradeReply',
              player: 0,
              id: tradeNotice.id,
              accept: true,
            })
          "
        >
          受諾
        </button>
        <button
          @click="
            act({
              type: 'tradeReply',
              player: 0,
              id: tradeNotice.id,
              accept: false,
            })
          "
        >
          拒否
        </button>
        <button @click="deferredTrades.push(tradeNoticeKey(tradeNotice.id))">
          後で返答
        </button>
      </template>
    </BlockingDialog>
    <RuleGuide
      v-if="ruleGuideOpener"
      :rules-version="s?.rulesVersion ?? V20_RULES_VERSION"
      :opener="ruleGuideOpener"
      @close="ruleGuideOpener = undefined"
    />
    <BlockingDialog v-if="store.pending" title="保存に失敗しました">
      <p>保存が完了するまで進行できません。確定済みの操作を再保存します。</p>
      <template #actions>
        <button class="primary" @click="retrySave">保存を再試行</button>
      </template>
    </BlockingDialog>
    <BlockingDialog
      v-if="menu && me && !store.pending"
      :title="
        menu === 'attributes'
          ? '能力値'
          : menu === 'inventory'
            ? '持ち物'
            : '課題'
      "
      :return-focus="menuOpener"
    >
      <nav class="tabs" v-if="menu === 'inventory'">
        <button
          :class="{ active: menuTab === 'materials' }"
          :aria-pressed="menuTab === 'materials'"
          @click="menuTab = 'materials'"
        >
          素材</button
        ><button
          :class="{ active: menuTab === 'potions' }"
          :aria-pressed="menuTab === 'potions'"
          @click="menuTab = 'potions'"
        >
          薬
        </button>
      </nav>
      <nav class="tabs" v-else-if="menu === 'goals'">
        <button
          :class="{ active: menuTab === 'daily' }"
          :aria-pressed="menuTab === 'daily'"
          @click="menuTab = 'daily'"
        >
          今日の課題</button
        ><button
          :class="{ active: menuTab === 'graduation' }"
          :aria-pressed="menuTab === 'graduation'"
          @click="menuTab = 'graduation'"
        >
          卒業課題
        </button>
      </nav>
      <template v-if="menu === 'attributes'">
        <AttributeDetails
          v-for="k in STATS"
          :key="k"
          :label="LABELS[k]"
          :stat="k"
          :value="me.stats[k]"
          :rules-version="s.rulesVersion"
          :recipes="me.recipes"
        />
      </template>
      <template v-else-if="menu === 'inventory'">
        <p v-if="!me.inventory.length">所持品なし</p>
        <article
          v-for="(count, kind) in Object.fromEntries(
            Object.entries(inventory).filter(
              ([kind]) => isMaterial(kind) === (menuTab === 'materials'),
            ),
          )"
          :key="kind"
        >
          <h3>
            <GameIcon :kind="String(kind)" />{{ itemName(String(kind)) }} ×
            {{ count.total }}
          </h3>
          <p v-if="count.free !== count.total">
            使用可能{{ count.free }} / 予約中{{ count.total - count.free }}
          </p>
          <p v-if="menuTab === 'potions'">
            {{ potionDescription(String(kind)) }}
          </p>
        </article>
        <details v-if="menuTab === 'potions'" class="panel">
          <summary>薬を使用する・補正を確認</summary>
          <p class="muted">休息 +{{ me.rest }} / 呪詛 −{{ me.curse }}</p>
          <div
            v-for="i in me.inventory.filter(
              (i) => ['purify', 'talent'].includes(i.kind) && !i.lock,
            )"
            :key="i.id"
            class="potion-use"
          >
            <template v-if="i.kind === 'talent'"
              ><select v-model="changeMagic">
                <option v-for="(m, k) in MAGICS" :key="k" :value="k">
                  {{ m.name }}
                </option>
              </select></template
            ><button
              :disabled="
                !can({
                  type: 'usePotion',
                  player: 0,
                  item: i.id,
                  magic: changeMagic,
                })
              "
              @click="
                act({
                  type: 'usePotion',
                  player: 0,
                  item: i.id,
                  magic: changeMagic,
                })
              "
            >
              <GameIcon :kind="i.kind" />{{ itemName(i.kind) }}を使う
            </button>
          </div>
        </details>
      </template>
      <template v-else>
        <h3>
          {{
            goalDescription(
              menuTab === "graduation" ? me.longGoal : me.dailyGoal,
              menuTab === "graduation",
            ).name
          }}
        </h3>
        <p>
          達成条件：{{
            goalDescription(
              menuTab === "graduation" ? me.longGoal : me.dailyGoal,
              menuTab === "graduation",
            ).condition
          }}
        </p>
        <template v-if="menuTab === 'daily' && hoProgress"
          ><p>
            {{ hoProgress.status }}：{{ hoProgress.current }} /
            {{ hoProgress.total }}
          </p>
          <p>{{ hoProgress.detail }}</p></template
        >
        <template v-else
          ><h4>確認できる進捗</h4>
          <p v-for="line in graduationProgress(s)" :key="line">{{ line }}</p>
          <p>
            {{
              me.longGoal.achieved
                ? "達成記録あり"
                : "8日目終了時に判定します。途中の確定判定はありません。"
            }}
          </p>
        </template>
      </template>
      <template #actions><button @click="menu = ''">閉じる</button></template>
    </BlockingDialog>
    <BlockingDialog
      v-if="
        showGameDialogs && secretResult && (!myCombat || battleStep === 'end')
      "
      :title="
        secretResult.kind === 'public' ? '公開決闘の結果' : '秘匿決闘の結果'
      "
    >
      <div class="battle-header">
        <strong
          >戦闘終了 · {{ secretResult.rounds.length }} / 最大5ラウンド</strong
        ><span v-for="(id, side) in secretResult.participants" :key="id"
          >{{ s.players[id].name }} HP {{ secretResult.hp[side] }}</span
        >
      </div>
      <h3>
        {{
          secretResult.winner === null
            ? "引き分け"
            : secretResult.winner === 0
              ? "あなたの勝利"
              : secretResult.kind === "public" &&
                  !secretResult.participants.includes(0)
                ? `${s.players[secretResult.winner!].name}の勝利`
                : "あなたの敗北"
        }}
      </h3>
      <p>
        {{
          secretResult.participants.map((id) => s.players[id].name).join(" vs ")
        }}
        · 最終HP {{ secretResult.hp.join(" / ") }}
      </p>
      <p>{{ combatReason(secretResult) }}</p>
      <p v-if="secretResult.winner !== null && secretResult.kind === 'public'">
        {{ s.players[secretResult.winner!].name }}の名声（FP）：{{
          s.players[secretResult.winner!].fp - publicDuelReward(s)
        }}
        → {{ s.players[secretResult.winner!].fp }}
      </p>
      <details>
        <summary>各ラウンドの判定履歴</summary>
        <CombatRounds
          :combat="secretResult"
          :names="secretResult.participants.map((id) => s.players[id].name)"
        />
      </details>
      <p v-if="secretResult.kind === 'secret'">
        当事者だけへの結果です。確認後に勝者の報酬選択・処理へ進みます。
      </p>
      <p v-else>
        {{
          secretResult.winner === null
            ? "引き分け：双方FP変動なし"
            : `${s.players[secretResult.winner!].name} FP+${publicDuelReward(s)}、敗者FP変動なし`
        }}。能力移転はありません。確認して公開フェーズへ戻ります。
      </p>
      <template #actions>
        <button class="primary" @click="act({ type: 'combatAck', player: 0 })">
          確認した
        </button>
      </template>
    </BlockingDialog>
    <BlockingDialog
      v-if="showGameDialogs && eventResult && event && progress"
      title="共通イベントの結果"
    >
      <h3>{{ event.name }}：{{ s.event.success ? "成功" : "失敗" }}</h3>
      <p>
        必要条件：{{ event.description
        }}<span v-if="event.id === 11"
          >（{{ itemName(s.event.specified) }}）</span
        >
      </p>
      <p>
        最終納品：素材 {{ progress.materials }}/{{ event.materials ?? 0 }}、薬
        {{ progress.potions }}/{{ event.potions ?? 0 }}、能力
        {{ progress.stats }}/{{ event.stats ?? 0 }}
      </p>
      <p v-if="event.actions">
        成立行動 {{ progress.actions }}/{{ event.count }}
      </p>
      <p v-if="event?.mock">
        模擬戦：{{ s.event.mock.length === 2 ? "完了" : "未完了" }}
      </p>
      <p v-if="event.required">
        必須素材：{{
          Object.entries(event.required)
            .map(([k, n]) => `${itemName(k)} ${progress?.counts[k] ?? 0}/${n}`)
            .join("、")
        }}
      </p>
      <p v-if="s.event.success && event.mock">
        模擬戦参加者は素材を2個ずつ獲得しました。
      </p>
      <p v-if="!s.event.success">
        失敗ペナルティ：研究所の失敗回数 +1。通算3回の失敗で直ちに全員敗北です。
      </p>
      <p v-else>
        成功報酬：{{
          event.most
            ? "最多納品者"
            : event.mock && !event.materials
              ? "模擬戦参加者に素材2個"
              : "条件を満たした貢献者"
        }}{{
          event.fp ? `に名声（FP）+${event.fp}` : ""
        }}。実際の付与は以下の結果を確認してください。
      </p>
      <p>
        {{
          s.event.success
            ? "有効な予約品・能力を消費しました。"
            : "予約品・能力は消費していません。"
        }}
        失敗 {{ s.failed }}/3
      </p>
      <p
        v-for="l in s.logs.filter(
          (l) => l.day === s.day && l.type === 'fp' && l.kind === 'event',
        )"
        :key="l.seq"
      >
        {{ uiText(logText(l)) }}
      </p>
      <p v-if="s.result?.reason === 'collapse'">
        イベント3回失敗により研究所が崩壊しました。全員敗北です。当日の日次HOは判定なし・報酬なしです。
      </p>
      <template #actions
        ><button class="primary" @click="act({ type: 'eventAck', player: 0 })">
          確認した
        </button></template
      >
    </BlockingDialog>
    <BlockingDialog
      v-if="showGameDialogs && s?.publicOutcome"
      title="公開決闘の結果"
    >
      <h3>{{ s.players[s.publicOutcome.to].name }}が降参</h3>
      <p>
        アイテム合計：{{ s.players[s.publicOutcome.from].name }}
        {{
          s.players[s.publicOutcome.from].inventory.length -
          s.publicOutcome.items.length
        }}
        → {{ s.players[s.publicOutcome.from].inventory.length }}個、{{
          s.players[s.publicOutcome.to].name
        }}
        {{
          s.players[s.publicOutcome.to].inventory.length +
          s.publicOutcome.items.length
        }}
        → {{ s.players[s.publicOutcome.to].inventory.length }}個
      </p>
      <p>
        {{ s.players[s.publicOutcome.from].name }}が{{
          s.publicOutcome.items.map(itemName).join("・")
        }}を獲得。双方FP増加なし。
      </p>
      <template #actions
        ><button
          class="primary"
          @click="act({ type: 'publicOutcomeAck', player: 0 })"
        >
          確認した
        </button></template
      >
    </BlockingDialog>
    <footer>
      <span>✧ 魔女たちの共同研究</span
      ><span
        >ローカル試遊版 · ルール {{ s?.rulesVersion ?? V20_RULES_VERSION }} ·
        公開前の検証用</span
      >
    </footer>
  </div>
</template>
