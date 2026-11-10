<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { GameState } from "../domain/types";
import { LABELS } from "../domain/config";
import { nightRecipe } from "../domain/night";
import { elementPotion } from "../domain/elementCombat";
import { recipe } from "../domain/items";
import {
  endingPresentation,
  type EndingPresentation,
  type EndingView,
} from "../ui/ending";
import { uiText } from "../ui/text";
const props = defineProps<{
  state?: GameState;
  record?: EndingPresentation;
  view: EndingView;
  readonly?: boolean;
}>();
const emit = defineEmits<{
  navigate: [view: EndingView];
  restart: [];
  exit: [];
}>();
const data = computed(() => props.record ?? endingPresentation(props.state!));
const view = computed(() => (data.value.collapsed ? "results" : props.view));
const collapsed = computed(() => data.value.collapsed);
const summary = computed(() => data.value.summary);
const rows = computed(() => data.value.rows);
const detail = (id: number) => data.value.details.find((d) => d.player === id)!;
const open = ref(false);
const heading = ref<HTMLElement>();
watch(view, async () => {
  open.value = false;
  await nextTick();
  heading.value?.focus();
});
const signed = (n: number) =>
  `${n > 0 ? "＋" : n < 0 ? "－" : ""}${Math.abs(n)}`;
const itemName = (kind: string) =>
  uiText(
    LABELS[kind] ??
      nightRecipe(kind)?.name ??
      elementPotion(kind)?.name ??
      recipe(kind)?.name ??
      kind,
  );
</script>

<template>
  <main class="ending-layout">
    <section
      v-if="view === 'summary'"
      class="panel day8-summary"
      aria-labelledby="day8-heading"
    >
      <p class="eyebrow">研究終了 · 確認待ち</p>
      <h1 id="day8-heading" ref="heading" tabindex="-1">第8日のまとめ</h1>
      <p>今日の記録を確認したら、「最終結果へ」で研究の結末を確認できます。</p>
      <section class="review-section" aria-label="本人の日次HO判定">
        <h2>
          今日の課題：{{
            summary.task
              ? summary.task.achieved
                ? "成功"
                : "失敗"
              : "記録なし"
          }}
        </h2>
        <p v-if="summary.task">
          {{ summary.taskName }}
        </p>
        <p>
          日次HO報酬：{{
            summary.reward === undefined
              ? "記録なし"
              : `${signed(summary.reward)}FP`
          }}
        </p>
      </section>
      <section class="review-section" aria-label="夜間行動の結果">
        <h2>あなたが確認できる夜間記録</h2>
        <ul v-if="summary.night.length">
          <li v-for="l in summary.night" :key="l.seq" :data-log-seq="l.seq">
            {{ uiText(l.text) }}
          </li>
        </ul>
        <p v-else>記録なし</p>
      </section>
      <section class="review-section" aria-label="持ち物の増減">
        <h2>持ち物の種類別増減（夜間）</h2>
        <p v-if="summary.inventory === undefined">記録なし</p>
        <ul v-else-if="Object.keys(summary.inventory).length">
          <li v-for="(amount, kind) in summary.inventory" :key="kind">
            {{ itemName(String(kind)) }}：{{ signed(amount) }}個
          </li>
        </ul>
        <p v-else>増減なし</p>
      </section>
      <section class="review-section" aria-label="全員の第8日FP">
        <h2>全員のFPと第8日の増減</h2>
        <div class="ending-cards">
          <article
            v-for="p in summary.players"
            :key="p.player"
            class="ending-card"
            :data-fp-player="p.player"
          >
            <h3>{{ p.name }}</h3>
            <p class="final-fp">現在FP {{ p.fp }}</p>
            <template v-if="p.breakdown">
              <p>
                第8日の増減：{{ signed(p.breakdown.change) }}FP
                <small
                  >（{{ p.breakdown.start }} → {{ p.breakdown.end }}）</small
                >
              </p>
              <ol v-if="p.breakdown.entries.length">
                <li v-for="e in p.breakdown.entries" :key="e.order">
                  {{ e.text }}：{{ signed(e.amount) }}FP
                </li>
              </ol>
              <p v-else>増減なし</p>
            </template>
            <p v-else>FP内訳：記録なし</p>
          </article>
        </div>
      </section>
      <button class="primary ending-next" @click="emit('navigate', 'results')">
        最終結果へ
      </button>
    </section>
    <section v-else class="panel final-results" aria-labelledby="final-heading">
      <p class="eyebrow">研究終了</p>
      <h1 id="final-heading" ref="heading" tabindex="-1">最終結果</h1>
      <p v-if="collapsed">
        共通イベントに通算3回失敗し、研究所は崩壊しました。
      </p>
      <p v-else>8日間の研究、おつかれさま。全員の結末を発表します。</p>
      <p v-if="!collapsed && !data.hasChief">首席なし</p>
      <div class="ending-cards" aria-label="全員の最終結果">
        <article
          v-for="r in rows"
          :key="r.player"
          class="ending-card"
          :class="{ 'chief-card': r.outcome === '首席' }"
          :data-result-player="r.player"
        >
          <h2>{{ r.name }}</h2>
          <p class="outcome">{{ r.outcome }}</p>
          <p>
            {{ r.rankText }} · <strong>{{ r.fp }}FP</strong>
          </p>
          <p>長期HO：{{ r.status }}</p>
          <p>日次HO成功：{{ r.daily }}回</p>
          <p
            v-if="
              collapsed &&
              !detail(r.player).daily.some((h) => h.day === data.day)
            "
          >
            第{{ data.day }}日の日次HO：未判定・報酬なし
          </p>
        </article>
      </div>
      <button
        class="ending-reveal"
        :aria-expanded="open"
        aria-controls="ending-ho-details"
        @click="open = !open"
      >
        {{ open ? "HOを閉じる" : "HOを公開" }}
      </button>
      <section
        v-if="open"
        id="ending-ho-details"
        class="ho-details"
        aria-label="全員のHO詳細"
      >
        <article v-for="r in rows" :key="r.player" class="review-section">
          <h2>{{ r.name }}のHO</h2>
          <h3>{{ detail(r.player).long.name }}：{{ r.status }}</h3>
          <p>{{ detail(r.player).long.condition }}</p>
          <h3>日次HO履歴</h3>
          <p v-if="!detail(r.player).daily.length">判定済みの記録なし</p>
          <ol v-else>
            <li v-for="h in detail(r.player).daily" :key="h.day">
              第{{ h.day }}日：{{ h.name }} ·
              {{ h.achieved ? "成功" : "失敗" }}
              <p>{{ h.condition }}</p>
            </li>
          </ol>
          <p
            v-if="
              collapsed &&
              !detail(r.player).daily.some((h) => h.day === data.day)
            "
          >
            第{{ data.day }}日：未判定・報酬なし
          </p>
        </article>
      </section>
      <div class="ending-actions">
        <button
          v-if="!collapsed && data.day === 8"
          @click="emit('navigate', 'summary')"
        >
          第8日のまとめを見る
        </button>
        <button v-if="!readonly" @click="emit('restart')">
          新しい研究を始める
        </button>
        <button v-else @click="emit('exit')">タイトルへ戻る</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.ending-layout {
  max-width: 1100px;
  margin: 1.5rem auto;
  min-width: 0;
}
.ending-layout h1 {
  font-size: clamp(1.6rem, 4vw, 2.4rem);
}
.ending-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin: 1rem 0;
}
.ending-card {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 1rem;
  background: var(--surface, rgba(255, 255, 255, 0.35));
}
.ending-layout p,
.ending-layout li,
.ending-layout h2,
.ending-layout h3 {
  overflow-wrap: anywhere;
}
.ending-card h2,
.ending-card h3 {
  margin-top: 0;
}
.final-fp,
.outcome {
  font-size: 1.3rem;
  font-weight: 700;
}
.chief-card {
  border: 2px solid #8b6a2e;
}
.ending-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1rem;
}
.ending-layout button {
  min-height: 44px;
  white-space: normal;
}
.ending-reveal,
.ending-next {
  margin-top: 1rem;
}
.ho-details {
  margin-top: 1rem;
}
@media (max-width: 600px) {
  .ending-cards {
    grid-template-columns: 1fr;
  }
  .ending-layout {
    margin: 0.75rem 0;
  }
  .ending-actions button,
  .ending-next {
    width: 100%;
  }
}
</style>
