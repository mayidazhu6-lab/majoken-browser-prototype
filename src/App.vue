<script setup lang="ts">
import { computed, ref, watch } from "vue";
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
import { goalDescription, dailyProgress } from "./domain/ho";
import { dispatch, currentPlayer } from "./domain/reducer";
import { serialize } from "./domain/persistence";
import type {
  Action,
  Magic,
  NightKind,
  Setup,
  Stat,
  Stance,
} from "./domain/types";
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
watch([() => s.value?.day, () => me.value?.night], syncNightDisplay, {
  immediate: true,
});
watch(
  () => s.value?.day,
  () => {
    hoNoticeDay.value = 0;
  },
);
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
  if (store.state !== previous) syncNightDisplay();
}
function startGame() {
  const previous = store.state;
  store.start(setup.value);
  if (store.state !== previous) syncNightDisplay();
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
const combat = computed(() => s.value?.combat);
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
const blockingModal = computed(
  () =>
    !!incomingTrade.value ||
    !!secretResult.value ||
    !!eventResult.value ||
    !!s.value?.publicOutcome,
);
const hoProgress = computed(() =>
  s.value ? dailyProgress(s.value, me.value) : undefined,
);
const interruptReason = computed(() => {
  if (incomingTrade.value)
    return "取引への返答待ちです。中央のダイアログで受諾・拒否してください。";
  if (secretResult.value)
    return `${secretResult.value.kind === "public" ? "公開" : "秘匿"}決闘の結果確認待ちです。内容を確認してOKを押してください。`;
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
  store.act(a);
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
function download() {
  if (!s.value) return;
  const url = URL.createObjectURL(
    new Blob([serialize(s.value)], { type: "application/json" }),
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
      ho: "HOを判定",
      dawn: "次の日へ",
      ended: "終了",
      rewards: "報酬選択",
    })[s.value?.phase ?? "public"],
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
        <span class="version">試遊版 v0.2.2</span
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
      {{ store.error }}<button @click="store.error = ''">閉じる</button>
    </div>
    <div v-if="store.notice" role="status" class="alert">
      {{ store.notice }}<button @click="store.notice = ''">閉じる</button>
    </div>
    <main v-if="!s" class="setup-layout">
      <section class="intro">
        <p class="eyebrow">8 DAYS / 4 WITCHES / ONE LABORATORY</p>
        <div class="sigil" aria-hidden="true">✦<span>☽</span></div>
        <h1>
          仲良くしないと負ける。<br />でも、仲良くするだけじゃ<br /><em
            >勝てない。</em
          >
        </h1>
        <p class="lead">
          研究所を守る8日間。<br />3人のAI魔女と協力しながら、<br />あなただけの秘密の研究を完成させよう。
        </p>
        <div class="intro-notes">
          <span>01　共同研究を成功させる</span
          ><span>02　秘密目標で卒業を目指す</span
          ><span>03　日次目標と名声で首席を競う</span>
        </div>
        <p class="muted">
          ブラウザ内で動く試験用ゲームです。保存データ・開発者表示には秘密情報を含みます。
        </p>
      </section>
      <section class="panel creation">
        <p class="eyebrow">YOUR WITCH</p>
        <h2>研究所へようこそ</h2>
        <p class="muted">名前、魔法、能力を決めて研究を始めましょう。</p>
        <label>魔女の名前<input v-model="setup.name" maxlength="24" /></label
        ><label
          >乱数シード<input v-model="setup.seed" maxlength="100" /><small
            >同じseedと操作で同じ結果を再現します。</small
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
            ><small>CD {{ m.cd }}日</small>
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
          <span class="eyebrow">RESEARCH JOURNAL</span>
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
          <small>{{ s.failed }} / 3 失敗</small>
        </div>
      </div>
      <section
        v-if="s.phase === 'public' || combat?.returnPhase === 'public'"
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
      <div class="game-grid">
        <aside class="left-column">
          <section class="panel">
            <div class="section-heading">
              <h2>研究室の魔女たち</h2>
              <small>PUBLIC</small>
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
                  ><span class="tag">{{ p.ai ? "AI" : "YOU" }}</span
                  ><b class="fp">{{ p.fp }} <small>FP</small></b>
                </div>
                <div class="stats">
                  <span v-for="k in STATS" :key="k"
                    >{{ LABELS[k] }} <b>{{ p.stats[k] }}</b
                    ><small>Lv{{ level(p.stats[k]) }}</small></span
                  >
                </div>
                <small class="muted"
                  >AP {{ "●".repeat(p.ap) }}{{ "○".repeat(2 - p.ap) }}</small
                >
              </div>
            </article>
          </section>
          <section class="panel secret">
            <div class="section-heading">
              <h2>あなただけの研究</h2>
              <small>PRIVATE</small>
            </div>
            <div class="goal">
              <span class="eyebrow">長期HO · 卒業条件</span>
              <h3>{{ goalDescription(me.longGoal, true).name }}</h3>
              <p>{{ goalDescription(me.longGoal, true).condition }}</p>
              <span class="tag">{{
                me.longGoal.achieved ? "達成記録あり" : "最終日に判定"
              }}</span>
            </div>
            <div class="goal">
              <span class="eyebrow">本日の日次HO · 達成でFP+1</span>
              <h3 :key="s.day" class="daily-ho-heading">
                本日の日次HO：{{ goalDescription(me.dailyGoal, false).name }}
              </h3>
              <p>{{ goalDescription(me.dailyGoal, false).condition }}</p>
              <p v-if="hoProgress" class="daily-ho-progress" role="status">
                <strong>{{ hoProgress.status }}</strong> ·
                {{ hoProgress.current }}/{{ hoProgress.total }}
              </p>
              <p v-if="hoProgress" class="muted">{{ hoProgress.detail }}</p>
              <small
                >これまでの日次達成：{{
                  me.dailyHistory.filter((h) => h.achieved).length
                }}回</small
              >
            </div>
            <div class="own-magic">
              <strong>{{ MAGICS[me.magic].name }}</strong
              ><span>{{
                me.availableDay <= s.day
                  ? "使用可能"
                  : `第${me.availableDay}日から`
              }}</span>
              <p>{{ MAGICS[me.magic].description }}</p>
              <small v-if="me.temporaryRecipe"
                >秘伝：{{ itemName(me.temporaryRecipe.kind) }}（第{{
                  me.temporaryRecipe.day
                }}日夜まで）</small
              >
            </div>
          </section>
          <details class="panel level-guide" :open="s.phase === 'public'">
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
          <section class="panel">
            <div class="section-heading">
              <h2>あなたの所持品</h2>
              <small>{{ me.inventory.length }} ITEMS</small>
            </div>
            <p v-if="!me.inventory.length" class="muted">所持品なし</p>
            <div
              class="inventory-row"
              v-for="(count, kind) in inventory"
              :key="kind"
            >
              <span>{{ itemName(String(kind)) }}</span
              ><b
                >{{ count.free
                }}<small v-if="count.total !== count.free">
                  / 予約{{ count.total - count.free }}</small
                ></b
              >
            </div>
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
          </section>
        </aside>
        <main class="center-column">
          <section v-if="s.result" class="panel final-results">
            <p class="eyebrow">RESEARCH COMPLETE</p>
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
                    : "卒業者なし：長期HO達成者がいません。"
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
                    <th>日次HO</th>
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
              <summary>{{ p.name }}のHOと判定根拠</summary>
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
          >
            <div class="section-heading">
              <span class="eyebrow">TODAY'S COOPERATIVE EVENT</span
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
            <p class="eyebrow">
              {{ combat.kind === "secret" ? "PRIVATE DUEL" : "PUBLIC DUEL" }} /
              ROUND {{ combat.rounds.length + Number(!combat.done) }} OF 5
            </p>
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
            <template v-if="!combat.done"
              ><p class="muted">
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
                </button>
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
            ><template v-else
              ><h3>
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
            <CombatRounds
              :combat="combat"
              :names="combat.participants.map((id) => s.players[id].name)"
            />
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
            v-if="s.phase === 'public' && hoNoticeDay !== s.day"
            class="panel daily-ho-notice"
            role="status"
          >
            <h2>
              {{ s.day }}日目の日次HO：{{
                goalDescription(me.dailyGoal, false).name
              }}
            </h2>
            <p>{{ goalDescription(me.dailyGoal, false).condition }}</p>
            <p>達成報酬：FP+1（本日のHO判定時）</p>
            <button @click="hoNoticeDay = s.day">確認しました</button>
          </section>
          <section v-if="s.phase === 'public'" class="panel turn-status">
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
            <nav class="tabs">
              <button
                v-for="(label, id) in {
                  field: '採集・研究',
                  event: '納品',
                  trade: '取引',
                  duel: '決闘',
                }"
                :key="id"
                :class="{ active: tab === id }"
                @click="
                  tab = id;
                  selected = [];
                "
              >
                {{ label }}
              </button>
            </nav>
            <template v-if="tab === 'field'"
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
              <div class="action-card">
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
              <div v-for="k in STATS" :key="k" class="action-card">
                <div>
                  <h3>{{ LABELS[k] }}を研究</h3>
                  <p>
                    {{ RESEARCH[k].map(itemName).join(" ＋ ") }}
                    各1個<br />成長：+{{
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
            <template v-if="tab === 'event'"
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
            <template v-if="tab === 'trade'"
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
              <hr />
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
            <template v-if="tab === 'duel'"
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
            <p class="eyebrow">PERSONAL MAGIC</p>
            <h2>今夜、固有魔法を使いますか？</h2>
            <h3>{{ MAGICS[me.magic].name }}</h3>
            <p>{{ MAGICS[me.magic].description }}</p>
            <label v-if="me.magic === 'barrier'"
              >保護対象<select v-model="target">
                <option v-for="p in s.players" :key="p.id" :value="p.id">
                  {{ p.name }}
                </option>
              </select></label
            ><button
              :disabled="!can({ type: 'magic', player: 0, target })"
              @click="act({ type: 'magic', player: 0, target })"
            >
              魔法を確定 <small>CD {{ MAGICS[me.magic].cd }}日</small>
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
          <section v-if="s.phase === 'night'" class="panel">
            <p class="eyebrow">AFTER DARK</p>
            <h2>秘密の行動をひとつ。</h2>
            <div class="night-options">
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
                  night = n;
                  nightPotion = undefined;
                  if (target === 0) target = 1;
                "
              >
                {{ LABELS[n] }}
              </button>
            </div>
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
                <button :disabled="!!me.night" @click="nightPlan.splice(i, 1)">
                  削除
                </button>
              </p>
              <p>作成予定 {{ nightPlan.length }} 個（固定上限なし）</p>
              <p v-if="!me.night && !brewCandidates.length">
                現在の所持素材で追加作成可能なレシピはありません。
              </p>
            </div>
            <label v-if="['guard', 'scout'].includes(night)"
              >同時に使う薬<select v-model="nightPotion" :disabled="!!me.night">
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
                  ? "右の個人通知で結果を確認し、次の日へ進みましょう。"
                  : "下の進行ボタンで結果を確定します。"
              }}
            </p>
            <p v-if="s.phase === 'dawn'">
              本日のHO：<strong>{{
                me.dailyGoal.achieved ? "達成 ✓" : "未達成"
              }}</strong>
            </p>
          </section>
          <section
            v-if="s.phase !== 'ended' && !combat && !s.challenge"
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
          <details v-if="s.phase !== 'public'" class="panel event-archive">
            <summary>共通イベントの履歴</summary>
            <article
              v-for="l in s.logs.filter((l) => l.type === 'eventResult')"
              :key="l.seq"
            >
              <h3>第{{ l.day }}日：{{ l.text }}</h3>
              <p>{{ EVENTS[Number(l.data?.event) - 1]?.description }}</p>
            </article>
          </details>
          <details
            v-if="publicHistory.length"
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
                    ? `${s.players[l.actor!].name}：${l.text}`
                    : l.text
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
            <h2>本日の結果</h2>
            <p>
              日次HO「{{ goalDescription(me.dailyGoal, false).name }}」：{{
                hoProgress?.status
              }}<span v-if="me.dailyGoal.achieved"> · 日次HO達成！ FP+1</span>
            </p>
            <p v-for="l in personalResults" :key="l.seq">{{ l.text }}</p>
          </section>
          <details v-if="history.length" class="panel">
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
        <aside class="right-column">
          <section class="panel journal">
            <div class="section-heading">
              <h2>研究日誌</h2>
              <small>LIVE LOG</small>
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
                <p>{{ l.text }}</p>
              </article>
            </div>
          </section>
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
              イベント3失敗で全員敗北。8日を終え、長期HO達成で卒業。卒業者だけを最終FPで順位付けし、最高FPが首席。同点は同率、未卒業者は順位なしです。
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
    <BlockingDialog v-if="incomingTrade" title="取引への返答が必要です">
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
      v-if="secretResult"
      :title="
        secretResult.kind === 'public' ? '公開決闘の結果' : '秘匿決闘の結果'
      "
    >
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
      <CombatRounds
        :combat="secretResult"
        :names="secretResult.participants.map((id) => s.players[id].name)"
      />
      <p v-if="secretResult.kind === 'secret'">
        当事者だけへの結果です。OKの後に勝者の報酬選択・処理へ進みます。
      </p>
      <p v-else>
        {{
          secretResult.winner === null
            ? "引き分け：双方FP変動なし"
            : `${s.players[secretResult.winner!].name} FP+1、敗者FP変動なし`
        }}。能力移転はありません。OKで公開フェーズへ戻ります。
      </p>
      <template #actions>
        <button class="primary" @click="act({ type: 'combatAck', player: 0 })">
          OK
        </button>
      </template>
    </BlockingDialog>
    <BlockingDialog
      v-if="eventResult && event && progress"
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
        {{ l.text }}
      </p>
      <p v-if="s.result?.reason === 'collapse'">
        イベント3回失敗により研究所が崩壊しました。全員敗北です。
      </p>
      <template #actions
        ><button class="primary" @click="act({ type: 'eventAck', player: 0 })">
          OK
        </button></template
      >
    </BlockingDialog>
    <BlockingDialog v-if="s?.publicOutcome" title="公開決闘の結果">
      <h3>{{ s.players[s.publicOutcome.to].name }}が降参</h3>
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
          OK
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
