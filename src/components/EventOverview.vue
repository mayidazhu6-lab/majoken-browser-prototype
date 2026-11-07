<script setup lang="ts">
import GameIcon from "./GameIcon.vue";
import { computed } from "vue";
import type { GameState } from "../domain/types";
import { EVENTS, eventProgress } from "../domain/events";
import { LABELS, V20_LABELS } from "../domain/config";
import { uiText } from "../ui/text";
const props = defineProps<{
  state: GameState;
  shortcuts?: boolean;
  reasonFor?: (action: string) => string;
}>();
const emit = defineEmits<{ navigate: [action: string] }>();
const event = computed(() => EVENTS[props.state.event.id - 1]);
const progress = computed(() => eventProgress(props.state));
const name = (kind: string) => uiText(V20_LABELS[kind] ?? LABELS[kind] ?? kind);
const metrics = computed(() => {
  const e = event.value,
    p = progress.value;
  return [
    ...(e.materials
      ? [{ label: "素材", value: p.materials, target: e.materials, unit: "個" }]
      : []),
    ...(e.potions
      ? [{ label: "薬", value: p.potions, target: e.potions, unit: "個" }]
      : []),
    ...(e.stats
      ? [{ label: "能力", value: p.stats, target: e.stats, unit: "点" }]
      : []),
    ...(e.actions
      ? [{ label: "成立行動", value: p.actions, target: e.count!, unit: "回" }]
      : []),
  ];
});
const required = computed(() =>
  event.value.id === 11
    ? { [props.state.event.specified]: event.value.materials! }
    : (event.value.required ?? {}),
);
const links = computed(() => {
  const e = event.value;
  return [
    ...(e.materials || e.potions || e.stats
      ? [{ action: "event", label: "納品へ（0AP）" }]
      : []),
    ...(e.mock && !props.state.event.mock.length
      ? [{ action: "mock", label: "模擬戦へ（0AP）" }]
      : []),
    ...(e.actions && progress.value.actions < e.count!
      ? e.actions.map((action) => ({
          action,
          label: `${action === "gather" ? "採集" : "研究"}へ（1AP）`,
        }))
      : []),
  ];
});
</script>
<template>
  <section
    class="event-panel event-overview"
    :data-difficulty="event.difficulty"
    aria-label="今日の協力イベント"
  >
    <div class="section-heading">
      <span class="eyebrow">今日の共通イベント · 全員で協力</span
      ><span class="difficulty" :class="event.difficulty">{{
        event.difficulty
      }}</span>
    </div>
    <h2>{{ event.name }}</h2>
    <p class="event-status">
      {{
        state.event.resolved
          ? state.event.success
            ? "✓ 成功確定"
            : "イベント失敗"
          : progress.success
            ? "✓ 条件充足・公開終了時に確定"
            : "達成に必要なもの"
      }}
    </p>
    <p v-if="event.either" class="route-note">
      素材・能力のいずれかで達成。先着ルート：{{
        state.event.route === "materials"
          ? "素材"
          : state.event.route === "stats"
            ? "能力"
            : "未確定"
      }}
    </p>
    <div class="event-metrics">
      <div v-for="m in metrics" :key="m.label" class="event-metric">
        <span
          >{{ m.label }} <b>{{ m.value }} / {{ m.target }}{{ m.unit }}</b></span
        ><small>不足{{ Math.max(0, m.target - m.value) }}{{ m.unit }}</small>
        <meter
          min="0"
          :max="m.target"
          :value="Math.min(m.target, m.value)"
          :aria-label="`${m.label} ${m.value} / ${m.target}${m.unit}`"
        ></meter>
      </div>
      <p v-if="event.mock">
        模擬戦 <b>{{ state.event.mock.length === 2 ? "完了" : "未完了" }}</b
        ><small>異なる2人で完了が必要</small>
      </p>
    </div>
    <p v-if="event.allowed">
      対象素材：{{ event.allowed.map(name).join("・") }}
    </p>
    <div class="required-materials" v-if="Object.keys(required).length">
      <strong>{{ event.id === 11 ? "指定素材" : "必須素材" }}</strong>
      <p v-for="(count, kind) in required" :key="kind">
        <GameIcon :kind="String(kind)" />{{ name(String(kind)) }}
        {{ progress.counts[kind] ?? 0 }} / {{ count }}個（不足{{
          Math.max(0, count - (progress.counts[kind] ?? 0))
        }}個）
      </p>
    </div>
    <div v-if="shortcuts && !state.event.resolved" class="event-shortcuts">
      <div v-for="link in links" :key="link.action">
        <button
          type="button"
          :disabled="!!reasonFor?.(link.action)"
          @click="emit('navigate', link.action)"
        >
          {{ link.label }}
        </button>
        <small v-if="reasonFor?.(link.action)">{{
          reasonFor(link.action)
        }}</small>
      </div>
    </div>
    <details class="event-help">
      <summary>達成条件・報酬と納品予約</summary>
      <p>
        {{ event.description
        }}<template v-if="event.id === 11"
          >：{{ name(state.event.specified) }}</template
        >
      </p>
      <p v-if="event.materials || event.potions || event.stats">
        数値は全員の納品予約の合計です。予約は成功確定時に採用された分だけ消費します。
      </p>
      <p v-if="event.mock && !event.materials">
        納品ではなく模擬戦の完了で判定します。
      </p>
      <p v-if="event.fp">
        成功時の貢献報酬：{{
          event.fp
        }}FP（対象はイベントごとの条件に従います）。
      </p>
      <details v-if="state.event.reservations.length">
        <summary>全員の納品予約を確認</summary>
        <p v-for="(r, i) in state.event.reservations" :key="i">
          {{ state.players[r.player].name }}：{{
            r.items
              .map((id) =>
                name(
                  state.players[r.player].inventory.find(
                    (item) => item.id === id,
                  )?.kind ?? "",
                ),
              )
              .join("・")
          }}<span v-for="(count, stat) in r.stats" :key="stat">
            {{ name(String(stat)) }} {{ count }}点</span
          >
        </p>
      </details>
    </details>
  </section>
</template>
