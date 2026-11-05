<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import { combatReason, revealedActions } from "./ui/combatPresentation";
import TaskBriefing from "./components/TaskBriefing.vue";
import BlockingDialog from "./components/BlockingDialog.vue";
import GroupedItems from "./components/GroupedItems.vue";
import { legalStances } from "./domain/combat";
import CombatRounds from "./components/CombatRounds.vue";
import { useGameStore } from "./stores/game";
import {
  CONFIG,
  LABELS,
  MAGICS,
  MATERIALS,
  RESEARCH,
  STATS,
  level,
  nextLevel,
  levelEffect,
} from "./domain/config";
import {
  EVENTS,
  eventProgress,
  reservationRoom,
  reservationUnits,
} from "./domain/events";
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
import { graduationProgress } from "./ui/graduationProgress";
import { uiText } from "./ui/text";
import { dispatch, currentPlayer } from "./domain/reducer";
import { serialize } from "./domain/persistence";
import type {
  Action,
  Combat,
  Magic,
  NightKind,
  Setup,
  Stat,
  Stance,
} from "./domain/types";
function goalDescription(...args: Parameters<typeof describeGoal>) {
  const description = describeGoal(...args);
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
const store = useGameStore();
const s = computed(() => store.state!);
const me = computed(() => s.value?.players[0]!);
const setup = ref<Setup>({
  name: "アリア",
  seed: "witches-2026",
  magic: "barrier",
  stats: { attack: 4, defense: 3, insight: 3 },
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
const actionLabels: Record<string, string> = {
  gather: "採集",
  research: "研究",
  event: "納品",
  shop: "購買部",
  trade: "魔女間取引",
  duel: "決闘",
};
const menu = ref("");
const menuTab = ref("materials");
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
function cancelAction() {
  actionScreen.value = "";
  selected.value = [];
  reserveStats.value = {};
  nightPlan.value = [];
  actionPotion.value = undefined;
}
function openAction(id: string) {
  cancelAction();
  actionScreen.value = id;
  if (["gather", "research"].includes(id)) tab.value = "field";
  else tab.value = id;
}
function restoreView() {
  cancelAction();
  menu.value = "";
  actionResult.value = [];
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
  nightRecipe.value = nightPlan.value[0] ?? "vigor";
  nightPotion.value = saved?.potion;
  target.value = saved?.target ?? 1;
}
function loadSave(json?: string) {
  const previous = store.state;
  store.load(json);
  if (store.state !== previous) {
    syncNightDisplay();
    restoreView();
    restorePresentation(json);
  }
}
function startGame() {
  const previous = store.state;
  store.start(setup.value);
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
const incomingTrade = computed(() => s.value?.trades.find((t) => t.to === 0));
const secretResult = computed(() =>
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
watch(brewCandidates, (candidates) => {
  if (!candidates.some((r) => r.id === nightRecipe.value))
    nightRecipe.value = candidates[0]?.id ?? "";
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
    ? "納品する品物・能力を選択してください。"
    : actionError({
        type: "reserve",
        player: 0,
        items: selected.value,
        stats: reserveStats.value,
      }),
);
const showGameDialogs = computed(
  () => !briefing.value && !actionResult.value.length,
);
const blockingModal = computed(
  () =>
    !!menu.value ||
    (showGameDialogs.value &&
      (!!incomingTrade.value ||
        (!!secretResult.value &&
          (!myCombat.value || battleStep.value === "end")) ||
        !!eventResult.value ||
        !!s.value?.publicOutcome)),
);
const hoProgress = computed(() =>
  s.value ? dailyProgress(s.value, me.value) : undefined,
);
const interruptReason = computed(() => {
  if (incomingTrade.value)
    return "取引への返答待ちです。中央のダイアログで受諾・拒否してください。";
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
const history = computed(
  () =>
    s.value?.combatHistory
      .filter((c) => c.kind !== "secret" || c.participants.includes(0))
      .reverse() ?? [],
);
const itemName = (kind: string) => LABELS[kind] ?? recipe(kind)?.name ?? kind;
function act(a: Action) {
  const previous = s.value;
  const seq = previous?.logs.at(-1)?.seq ?? 0;
  store.act(a);
  if (s.value !== previous) {
    if (s.value.combat?.id !== previous?.combat?.id)
      battleStep.value = s.value.combat?.done ? "end" : "intro";
    if (a.type === "reward" || a.type === "combatAck") {
      const lines = s.value.logs
        .filter(
          (l) =>
            l.seq > seq &&
            l.type !== "combatAck" &&
            (l.audience === "public" ||
              (Array.isArray(l.audience) && l.audience.includes(0))),
        )
        .map((l) => l.text);
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
    if (a.type === "round") {
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
        "trade",
        "night",
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
        .map((l) => l.text);
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
function restorePresentation(json?: string) {
  try {
    const view = json
      ? JSON.parse(json).presentation
      : JSON.parse(localStorage.getItem("majoken-ui-v023") ?? "null");
    if (
      view?.version !== 1 ||
      view.key !== JSON.stringify([s.value?.setup, s.value?.actions])
    )
      return;
    graduation.value = view.graduation === true;
    hoNoticeDay.value = Number.isInteger(view.day) ? view.day : 0;
    actionResult.value = Array.isArray(view.actionResult)
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
      localStorage.setItem("majoken-ui-v023", JSON.stringify(presentation()));
    } catch {
      /* Game save and JSON export remain available. */
    }
  },
  { flush: "post" },
);
function potionDescription(kind: string) {
  const r = recipe(kind);
  if (!r) return "";
  return {
    gather: `採集の獲得数 +${r.power}`,
    research: `研究の成長 +${r.power}`,
    cleanse: "呪詛を解除",
    guard: `警戒の防御補正 +${r.power}`,
    scout: `偵察の確認数 +${r.power}`,
    attack: `戦闘の攻撃補正 +${r.power}`,
    defense: `戦闘の防御補正 +${r.power}`,
    charge: `戦闘のためる補正 +${r.power}`,
    change: "固有魔法を変更",
  }[r.effect];
}
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
function next() {
  act(
    s.value?.phase === "public" && s.value.publicTurn.round <= 2
      ? { type: "endTurn", player: 0 }
      : { type: "advance" },
  );
}
const nextLabel = computed(
  () =>
    ({
      public: "手番終了 / パス",
      magic: "秘匿行動へ",
      vote: "投票を締め切る",
      night: "秘匿行動を解決",
      duels: "秘匿決闘を進める",
      results: "夜結果を確定",
      ho: "今日の課題を判定",
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
      menu.value,
      menuTab.value,
      battleStep.value,
      combat.value?.id,
      !!eventResult.value,
      !!secretResult.value,
    ].join(":"),
  async () => {
    await nextTick();
    window.scrollTo({ top: 0, behavior: "instant" });
    document
      .querySelector<HTMLElement>("main h2, .center-column h2")
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
        <span class="version">試遊版 v0.2.3</span
        ><button @click="loadSave()">続きから</button
        ><template v-if="s"
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
    <div v-if="store.error" role="alert" class="alert error">
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
          研究所を守る8日間。<br />3人のAI魔女と協力しながら、<br />あなただけの秘密の研究を完成させよう。
        </p>
        <button class="primary start-button" @click="creation = true">
          ゲーム開始 →
        </button>
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
        <label>魔女の名前<input v-model="setup.name" maxlength="24" /></label
        ><label
          >乱数シード<input v-model="setup.seed" maxlength="100" /><small
            >同じシードと操作で同じ結果を再現します。</small
          ></label
        >
        <div class="field-label">固有魔法</div>
        <div class="magic-options">
          <button
            v-for="(m, id) in MAGICS"
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
          <span :class="total === 10 ? 'mint' : 'pink'">{{ total }} / 10</span>
        </div>
        <div class="stat-inputs">
          <label v-for="k in STATS" :key="k"
            >{{ LABELS[k]
            }}<input
              v-model.number="setup.stats[k]"
              type="number"
              min="2"
              max="6"
          /></label>
        </div>
        <p class="muted">各能力2＋自由4ポイント。能力6でLv2、9でLv3。</p>
        <button
          class="primary start-button"
          :disabled="total !== 10 || !setup.name.trim() || !setup.seed"
          @click="startGame"
        >
          8日間の研究をはじめる <span>→</span>
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
            v-for="(p, i) in phaseSteps"
            :key="p"
            :class="{ active: s.phase === p }"
            ><small>0{{ i + 1 }}</small
            >{{ LABELS[p] }}</span
          >
        </nav>
        <div class="risk">
          <span>研究所の危機</span>
          <div>
            <b v-for="i in 3" :key="i" :class="{ failed: i <= s.failed }">✦</b>
          </div>
          <small>{{ s.failed }} / 3 失敗（通算3回で全員敗北）</small
          ><strong>残りAP {{ me.ap }} / 2 · 名声 {{ me.fp }}</strong>
        </div>
      </div>
      <section
        v-if="s.phase === 'public' && !combat"
        class="panel persistent-turn"
        role="status"
      >
        <strong>{{
          s.publicTurn.round <= 2
            ? `公開行動・第${s.publicTurn.round}巡`
            : "公開行動完了"
        }}</strong>
        <span v-if="currentPlayer(s) !== undefined"
          >現在の手番：{{ s.players[currentPlayer(s)!].name }}</span
        >
        <p v-if="interruptReason" class="interrupt-reason">
          {{ interruptReason }}
        </p>
      </section>
      <nav
        v-if="
          !briefing &&
          !combat &&
          ['public', 'magic', 'night', 'vote'].includes(s.phase)
        "
        class="common-menu"
        aria-label="共通メニュー"
      >
        <button
          @click="
            menu = 'inventory';
            menuTab = 'materials';
          "
        >
          🎒<br />持ち物
        </button>
        <button
          @click="
            menu = 'goals';
            menuTab = 'daily';
          "
        >
          📜<br />課題
        </button>
      </nav>
      <TaskBriefing
        v-if="briefing"
        :graduation="graduation"
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
        <button class="primary" @click="actionResult = []">確認した</button>
      </section>
      <div
        v-else
        class="game-grid"
        :class="{ 'battle-screen': !!combat, 'action-detail': !!actionScreen }"
      >
        <aside v-if="!combat && !actionScreen" class="left-column">
          <section class="panel">
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
                  ><b v-if="p.id === 0" class="fp"
                    >{{ p.fp }} <small>FP</small></b
                  >
                </div>
                <div class="stats">
                  <span v-for="k in STATS" :key="k"
                    >{{ LABELS[k] }} <b>{{ p.stats[k] }}</b
                    ><small v-if="p.id === 0"
                      >Lv{{ level(p.stats[k]) }}</small
                    ></span
                  >
                </div>
                <small v-if="p.id === 0" class="muted"
                  >AP {{ "●".repeat(p.ap) }}{{ "○".repeat(2 - p.ap) }}</small
                >
                <small>アイテム合計 {{ p.inventory.length }} 個</small>
              </div>
            </article>
          </section>
          <details class="panel level-guide">
            <summary>あなたの能力Lvと解禁効果</summary>
            <p v-for="k in STATS" :key="k" :data-stat="k">
              {{ LABELS[k] }} {{ me.stats[k] }} / Lv{{ level(me.stats[k])
              }}<br />
              {{
                nextLevel(me.stats[k]) === null
                  ? "最高Lvです"
                  : `次のLvまであと${nextLevel(me.stats[k])! - me.stats[k]}（能力値${nextLevel(me.stats[k])}）`
              }}<br />{{ levelEffect(k, level(me.stats[k])) }}
            </p>
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
              卒業者のみを最終FPで順位付けします。同点は同率。未卒業者には順位を付けません。
            </p>
            <button @click="store.state = undefined">新しい研究を始める</button>
          </section>
          <section
            v-if="event && progress && s.phase === 'public'"
            class="panel event-panel"
            v-show="actionScreen === 'event'"
          >
            <div class="section-heading">
              <span class="eyebrow">今日の共通イベント</span
              ><span class="difficulty" :class="event.difficulty">{{
                event.difficulty
              }}</span>
            </div>
            <h2>{{ event.name }}</h2>
            <p>
              {{ event.description
              }}<strong v-if="event.id === 11"
                >：{{ itemName(s.event.specified) }}</strong
              >
            </p>
            <p v-if="event.either">
              先着ルート：{{
                s.event.route === "materials"
                  ? "素材"
                  : s.event.route === "stats"
                    ? "能力"
                    : "未確定"
              }}
            </p>
            <div class="event-metrics">
              <span v-if="event.materials"
                >素材
                <b>{{ progress.materials }} / {{ event.materials }}</b></span
              ><span v-if="event.stats"
                >能力 <b>{{ progress.stats }} / {{ event.stats }}</b></span
              ><span v-if="event.potions"
                >薬 <b>{{ progress.potions }} / {{ event.potions }}</b></span
              ><span v-if="event.actions"
                >成立行動
                <b>{{ progress.actions }} / {{ event.count }}</b></span
              ><span v-if="event.mock"
                >模擬戦
                <b>{{ s.event.mock.length ? "完了" : "未完了" }}</b></span
              >
            </div>
            <div class="progress-track">
              <i
                :style="{
                  width: s.event.resolved
                    ? s.event.success
                      ? '100%'
                      : '0%'
                    : progress.success
                      ? '100%'
                      : `${Math.min(95, Math.max(progress.materials / (event.materials || 99), progress.stats / (event.stats || 99), progress.potions / (event.potions || 99), progress.actions / (event.count || 99)) * 100)}%`,
                }"
              ></i>
            </div>
            <p class="event-status">
              {{
                s.event.resolved
                  ? s.event.success
                    ? "✓ 共同研究、成功。"
                    : "イベント失敗。予約品は返却されました。"
                  : progress.success
                    ? "✓ 条件充足。公開フェーズ終了時に確定します。"
                    : "仲間と協力して、必要条件を満たしましょう。"
              }}
            </p>
            <p v-if="event.required" class="muted">
              必須：<span v-for="(n, k) in event.required" :key="k"
                >{{ itemName(String(k)) }} {{ progress.counts[k] ?? 0 }} /
                {{ n }}　</span
              >
            </p>
            <details v-if="s.event.reservations.length">
              <summary>全員の納品予約を確認</summary>
              <p v-for="(r, i) in s.event.reservations" :key="i">
                {{ s.players[r.player].name }}：{{
                  r.items
                    .map((id) =>
                      itemName(
                        s.players[r.player].inventory.find((i) => i.id === id)
                          ?.kind ?? "",
                      ),
                    )
                    .join("・")
                }}
                <span v-for="(n, k) in r.stats" :key="k"
                  >{{ LABELS[k] }} {{ n }}
                </span>
              </p>
            </details>
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
          <section v-if="s.challenge" class="panel">
            <h2>
              {{ s.players[s.challenge.from].name }}から{{
                s.challenge.mock ? "模擬戦" : "公開決闘"
              }}の挑戦
            </h2>
            <p>対戦を受けるか、降参品を渡して終了できます。</p>
            <GroupedItems v-model="selected" :items="available(me)" />
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
              {{ s.challenge.mock ? "辞退" : "素材2個 / 薬1個で降参" }}
            </button>
          </section>
          <section v-if="combat && myCombat" class="panel combat-panel">
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
            <h2>先に命令のAPを実行</h2>
            <p>
              残り{{
                me.commands.length
              }}件。秘匿決闘の命令報酬により、採集か研究を実行します。1件につき1AP消費。命令者：{{
                me.commands.map((c) => s.players[c.from].name).join("・")
              }}。対象：{{ me.name }}。
            </p>
            <button
              class="primary"
              @click="act({ type: 'forced', player: 0, kind: 'gather' })"
            >
              命令の採集を実行</button
            ><select v-model="forcedStat">
              <option v-for="k in STATS" :key="k" :value="k">
                {{ LABELS[k] }}
              </option></select
            ><button
              :disabled="
                !can({
                  type: 'forced',
                  player: 0,
                  kind: 'research',
                  stat: forcedStat,
                })
              "
              @click="
                act({
                  type: 'forced',
                  player: 0,
                  kind: 'research',
                  stat: forcedStat,
                })
              "
            >
              命令の研究を実行
            </button>
          </section>
          <section
            v-if="s.phase === 'public' && !combat && !actionScreen"
            class="panel turn-status"
          >
            <h2>
              {{
                s.publicTurn.round <= 2
                  ? `公開 ${s.publicTurn.round}巡目`
                  : "公開行動完了"
              }}
            </h2>
            <p v-if="currentPlayer(s) !== undefined">
              手番：{{ s.players[currentPlayer(s)!].name }} · 順番
              {{
                s.publicTurn.order.map((id) => s.players[id].name).join(" → ")
              }}
            </p>
            <p v-if="s.publicTurn.acted">
              通常行動は完了しました。0AP行動の後、手番を終了してください。
            </p>
          </section>
          <section
            v-if="s.phase === 'public' && !combat && !s.challenge"
            class="panel actions-panel"
          >
            <div class="section-heading">
              <h2>今日、何を研究する？</h2>
              <span class="ap-badge">{{ me.ap }} AP</span>
            </div>
            <p v-if="!actionScreen">
              1AP行動を1回選び、納品・取引を済ませたら「手番終了」へ。何もしないでパスすることもできます。
            </p>
            <p v-if="!actionScreen && event">
              今日の共通イベント：{{ event.name }}。条件：{{
                event.description
              }}。納品の対象・数量は「納品」で確認できます。
            </p>
            <nav v-if="!actionScreen" class="action-menu">
              <button
                v-for="(label, id) in {
                  gather: '採集',
                  research: '研究',
                  event: '納品',
                  shop: '購買部',
                  trade: '魔女間取引',
                  duel: '決闘',
                }"
                :key="id"
                :class="{ active: tab === id }"
                @click="openAction(id)"
              >
                {{ label }}
              </button>
            </nav>
            <button v-if="actionScreen" @click="cancelAction">
              キャンセルして戻る
            </button>
            <h3 v-if="actionScreen">{{ actionLabels[actionScreen] }}</h3>
            <template v-if="actionScreen && tab === 'field'"
              ><label
                >行動と同時に使う薬<select v-model="actionPotion">
                  <option :value="undefined">なし</option>
                  <option
                    v-for="i in available(me).filter((i) =>
                      ['gather', 'research'].includes(
                        recipe(i.kind)?.effect ?? '',
                      ),
                    )"
                    :key="i.id"
                    :value="i.id"
                  >
                    {{ itemName(i.kind) }}
                  </option>
                </select></label
              >
              <div v-if="actionScreen === 'gather'" class="action-card">
                <div>
                  <h3>森で採集</h3>
                  <p>
                    素材を基本2個、6種類から等確率で獲得。<br />今回の獲得数：{{
                      Math.max(
                        0,
                        2 +
                          me.rest -
                          me.curse +
                          (recipe(
                            me.inventory.find((i) => i.id === actionPotion)
                              ?.kind ?? "",
                          )?.effect === "gather"
                            ? recipe(
                                me.inventory.find((i) => i.id === actionPotion)!
                                  .kind,
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
                class="action-card"
              >
                <div>
                  <h3>{{ LABELS[k] }}を研究</h3>
                  <p>
                    {{ RESEARCH[k].map(itemName).join(" ＋ ") }}
                    各1個
                    <span
                      v-for="kind in RESEARCH[k]"
                      :key="kind"
                      class="material-count"
                      >{{ itemName(kind) }}：必要1 / 使用可能{{
                        inventory[kind]?.free ?? 0
                      }}（所持{{ inventory[kind]?.total ?? 0 }}）</span
                    >
                    <br />成長：+{{
                      Math.max(
                        0,
                        1 +
                          me.rest -
                          me.curse +
                          (recipe(
                            me.inventory.find((i) => i.id === actionPotion)
                              ?.kind ?? "",
                          )?.effect === "research"
                            ? recipe(
                                me.inventory.find((i) => i.id === actionPotion)!
                                  .kind,
                              )!.power
                            : 0),
                      )
                    }}
                  </p>
                </div>
                <button
                  :disabled="
                    !can({
                      type: 'research',
                      player: 0,
                      stat: k,
                      potion: actionPotion,
                    })
                  "
                  @click="
                    act({
                      type: 'research',
                      player: 0,
                      stat: k,
                      potion: actionPotion,
                    })
                  "
                >
                  研究 <small>1AP</small>
                </button>
              </div></template
            >
            <template v-if="actionScreen && tab === 'event'"
              ><p class="reservation-limit">
                {{
                  s.publicTurn.round === 1
                    ? `第1巡：1人1個まで（素材・薬・能力1ポイントを合算）。予約済み${reservationUnits(s, me)}、残り${reservationRoom(s, me)}。取消で枠が回復します。`
                    : "第2巡：個人上限なし。残りの納品枠へ先着順で予約できます。"
                }}
              </p>
              <p>納品は0AP。成功時のみ消費し、失敗時は返却します。</p>
              <GroupedItems v-model="selected" :items="donationCandidates" />
              <div v-if="event?.stats" class="stat-inputs">
                <label v-for="k in STATS" :key="k"
                  >{{ LABELS[k]
                  }}<input
                    v-model.number="reserveStats[k]"
                    type="number"
                    min="0"
                    :max="me.stats[k] - 1"
                    placeholder="0"
                /></label>
              </div>
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
                仮納品する</button
              ><button @click="act({ type: 'withdraw', player: 0 })">
                自分の予約をすべて撤回
              </button>
              <p v-if="reserveReason" class="operation-reason" role="status">
                {{ reserveReason }}
              </p>
              <p v-if="!donationCandidates.length" class="muted">
                このイベントに納品できる未予約の品物がありません。必要条件・予約済みの数量も確認してください。
              </p>
            </template>
            <template v-if="actionScreen && tab === 'shop'"
              ><h3>購買部 <span class="tag">1AP</span></h3>
              <p class="muted">任意の素材3個 → 指定素材1個</p>
              <GroupedItems
                v-model="selected"
                :items="available(me).filter((i) => MATERIALS.includes(i.kind))"
              />
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
                3個を交換
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
                <summary>提供と要求の個数を入力</summary>
                <div class="trade-row">
                  <span>品目</span><span>渡す</span><span>もらう</span>
                </div>
                <div
                  v-for="kind in [...MATERIALS, ...RECIPES.map((r) => r.id)]"
                  :key="kind"
                  class="trade-row"
                >
                  <span>{{ itemName(kind) }}</span
                  ><input
                    v-model.number="tradeOffer[kind]"
                    type="number"
                    min="0"
                    :max="inventory[kind]?.free ?? 0"
                    :aria-label="`${itemName(kind)} 提供数`"
                    placeholder="0"
                  /><input
                    v-model.number="tradeRequest[kind]"
                    type="number"
                    min="0"
                    :aria-label="`${itemName(kind)} 要求数`"
                    placeholder="0"
                  />
                </div>
              </details>
              <button
                :disabled="
                  currentPlayer(s) !== 0 ||
                  !!s.trades.length ||
                  me.pendingRecipe
                "
                @click="offer"
              >
                固定条件で提案
              </button>
              <p class="muted">
                相手の所持品は非公開。AIは即時受諾／拒否します。片側0個の譲渡も可能です。
              </p></template
            >
            <template v-if="actionScreen && tab === 'duel'"
              ><label
                >対戦相手<select v-model="target">
                  <option
                    v-for="p in s.players.slice(1)"
                    :key="p.id"
                    :value="p.id"
                  >
                    {{ p.name }}
                  </option>
                </select></label
              >
              <p>
                公開決闘：挑戦者1AP、被挑戦者0AP。勝者FP+1、能力移転なし。<br />模擬戦：イベント用。勝敗は達成条件に影響しません。
              </p>
              <button
                :disabled="!can({ type: 'duel', player: 0, target })"
                @click="act({ type: 'duel', player: 0, target })"
              >
                公開決闘 <small>1AP</small></button
              ><button
                :disabled="
                  !can({ type: 'duel', player: 0, target, mock: true })
                "
                @click="act({ type: 'duel', player: 0, target, mock: true })"
              >
                イベント模擬戦 <small>0AP</small>
              </button></template
            >
          </section>
          <section
            v-if="s.phase === 'magic' && !combat && !s.challenge"
            class="panel"
          >
            <p class="eyebrow">固有魔法</p>
            <h2>今夜、固有魔法を使いますか？</h2>
            <h3>{{ MAGICS[me.magic].name }}</h3>
            <p>{{ MAGICS[me.magic].description }}</p>
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
              魔法を確定 <small>再使用まで {{ MAGICS[me.magic].cd }}日</small>
            </button>
            <p v-if="me.activeMagic" class="mint">使用を確定しました。</p>
            <p class="muted">使用せずに次へ進むこともできます。</p>
          </section>
          <section
            v-if="
              s.phase === 'vote' && me.activeMagic && me.magic === 'foresight'
            "
            class="panel"
          >
            <h2>予知 · 明日のイベントを選ぶ</h2>
            <button
              v-for="id in s.foresight"
              :key="id"
              :disabled="s.votes[0] !== undefined"
              :class="{ chosen: s.votes[0] === id }"
              @click="act({ type: 'vote', player: 0, event: id })"
            >
              {{ EVENTS[id - 1].name }}（{{ EVENTS[id - 1].difficulty }}）
            </button>
            <p class="muted">使用者の匿名投票で決定。同票は抽選します。</p>
          </section>
          <section v-if="s.phase === 'night'" class="panel night-panel">
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
                {{ LABELS[n] }}
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
                  <option v-for="r in brewCandidates" :key="r.id" :value="r.id">
                    {{ r.name }}（{{ r.materials.map(itemName).join("＋") }}）
                  </option>
                </select></label
              >
              <div v-if="night === 'brew'">
                <p
                  v-for="kind in [
                    ...new Set(recipe(nightRecipe)?.materials ?? []),
                  ]"
                  :key="kind"
                  class="material-count"
                >
                  {{ itemName(kind) }}：1個作成に必要{{
                    recipe(nightRecipe)?.materials.filter((m) => m === kind)
                      .length
                  }}
                  / 使用可能{{ inventory[kind]?.free ?? 0 }}（所持{{
                    inventory[kind]?.total ?? 0
                  }}）
                </p>
                <p v-if="nightPlan.length">
                  作成予定分も含め、素材が足りるレシピのみ追加できます。
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
                  {{ itemName(id) }}
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
            v-if="
              ['duels', 'results', 'ho', 'dawn'].includes(s.phase) &&
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
                  ho: "今日の研究成果を判定",
                  dawn: "新しい朝がやってきた。",
                }[s.phase as "duels"]
              }}
            </h2>
            <p>
              {{
                s.phase === "dawn"
                  ? "下の1日のまとめを確認し、次の日へ進みましょう。"
                  : "下の進行ボタンで結果を確定します。"
              }}
            </p>
            <p v-if="s.phase === 'dawn'">
              今日の課題：<strong>{{
                me.dailyGoal.achieved ? "達成 ✓" : "未達成"
              }}</strong>
            </p>
          </section>
          <section
            v-if="
              s.phase !== 'ended' && !combat && !s.challenge && !actionScreen
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
                me.pendingRecipe ||
                !!s.combat ||
                !!s.challenge ||
                !!s.trades.length ||
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
              <h3>第{{ l.day }}日：{{ uiText(l.text) }}</h3>
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
                    ? `${s.players[l.actor!].name}：${uiText(l.text)}`
                    : uiText(l.text)
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
              ['results', 'ho', 'dawn', 'ended'].includes(s.phase) && !combat
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
              {{ uiText(l.text) }}
            </p>
            <p v-for="l in nightResults" :key="l.seq">{{ uiText(l.text) }}</p>
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
                <p>{{ uiText(l.text) }}</p>
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
            <p>
              提供：{{
                t.offer
                  .map((id) =>
                    itemName(
                      s.players[t.from].inventory.find((i) => i.id === id)
                        ?.kind ?? "",
                    ),
                  )
                  .join("・") || "なし"
              }}
            </p>
            <p>
              要求：{{
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
          <details class="panel quick-guide">
            <summary>遊び方・勝敗条件</summary>
            <p>
              毎日2巡、手番ごとに1APで採集・研究・購買部を利用します。公開決闘は1AP、勝者に1FP。取引・仮納品・模擬戦は0AP。錬金は夜だけです。
            </p>
            <p>
              イベント3失敗で全員敗北。8日を終え、卒業課題達成で卒業。卒業者だけを最終FPで順位付けし、最高FPが首席。同点は同率、未卒業者は順位なしです。
            </p>
            <p>
              夜は固有魔法と秘匿行動。休息は翌日の育成を助け、襲撃・呪詛・偵察はライバルへの干渉です。
            </p>
            <p>保存は操作ごとに自動実行。JSON保存も利用できます。</p>
          </details>
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
        <p>
          seed: {{ s.seed }} / RNG draws: {{ s.draws }} / day: {{ s.day }} /
          phase: {{ s.phase }} / revision: {{ s.revision }} /
          {{ s.rulesVersion }}
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
      v-if="menu && me"
      :title="menu === 'inventory' ? '持ち物' : '課題'"
    >
      <nav class="tabs" v-if="menu === 'inventory'">
        <button @click="menuTab = 'materials'">素材</button
        ><button @click="menuTab = 'potions'">薬</button>
      </nav>
      <nav class="tabs" v-else>
        <button @click="menuTab = 'daily'">今日の課題</button
        ><button @click="menuTab = 'graduation'">卒業課題</button>
      </nav>
      <template v-if="menu === 'inventory'">
        <p v-if="!me.inventory.length">所持品なし</p>
        <article
          v-for="(count, kind) in Object.fromEntries(
            Object.entries(inventory).filter(
              ([kind]) => isMaterial(kind) === (menuTab === 'materials'),
            ),
          )"
          :key="kind"
        >
          <h3>{{ itemName(String(kind)) }} × {{ count.total }}</h3>
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
              {{ itemName(i.kind) }}を使う
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
      v-if="showGameDialogs && incomingTrade"
      title="取引への返答が必要です"
    >
      <p>
        未決の取引があるため、手番進行と公開行動を停止しています。受諾・拒否するまで表示します。
      </p>
      <h3>
        取引提案：{{ s.players[incomingTrade.from].name }} → {{ me.name }}
      </h3>
      <p>
        提供：{{
          incomingTrade.offer
            .map((id) =>
              itemName(
                s.players[incomingTrade!.from].inventory.find(
                  (i) => i.id === id,
                )?.kind ?? "",
              ),
            )
            .join("・") || "なし"
        }}
      </p>
      <p>
        要求：{{
          Object.entries(incomingTrade.request)
            .map(([k, n]) => `${itemName(k)} ×${n}`)
            .join("・") || "なし"
        }}
      </p>
      <p>成立・拒否とも0AP。内容は当事者だけに表示します。</p>
      <template #actions>
        <button
          class="primary"
          @click="
            act({
              type: 'tradeReply',
              player: 0,
              id: incomingTrade.id,
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
              id: incomingTrade.id,
              accept: false,
            })
          "
        >
          拒否
        </button>
      </template>
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
          s.players[secretResult.winner!].fp - 1
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
            : `${s.players[secretResult.winner!].name} FP+1、敗者FP変動なし`
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
      <p v-if="event.mock">
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
        {{ uiText(l.text) }}
      </p>
      <p v-if="s.result?.reason === 'collapse'">
        イベント3回失敗により研究所が崩壊しました。全員敗北です。
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
        >ローカル試遊版 · ルール {{ CONFIG.rulesVersion }} ·
        公開前の検証用</span
      >
    </footer>
  </div>
</template>
