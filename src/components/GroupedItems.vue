<script setup lang="ts">
import { computed } from "vue";
import QuantitySpinner from "./QuantitySpinner.vue";
import type { Item } from "../domain/types";
import { LABELS } from "../domain/config";
import { uiText } from "../ui/text";
import GameIcon from "./GameIcon.vue";
import { recipe } from "../domain/items";
const props = defineProps<{
  items: Item[];
  modelValue: number[];
  purpose?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [number[]] }>();
const groups = computed(() =>
  [...new Set(props.items.map((i) => i.kind))].map((kind) => ({
    kind,
    items: props.items.filter((i) => i.kind === kind),
  })),
);
function quantity(kind: string, input: HTMLInputElement) {
  const count = Number(input.value);
  const pool = props.items.filter((i) => i.kind === kind);
  if (!Number.isInteger(count) || count < 0 || count > pool.length) {
    input.value = String(
      props.modelValue.filter((id) => pool.some((i) => i.id === id)).length,
    );
    return;
  }
  const other = props.modelValue.filter((id) => !pool.some((i) => i.id === id));
  emit("update:modelValue", [
    ...other,
    ...pool.slice(0, count).map((i) => i.id),
  ]);
}
</script>
<template>
  <div class="grouped-items">
    <label v-for="g in groups" :key="g.kind"
      ><span
        ><GameIcon :kind="g.kind" />
        {{ uiText(LABELS[g.kind] ?? recipe(g.kind)?.name ?? g.kind) }}</span
      >（選択可能{{ g.items.length }}個）
      <small
        >{{ purpose ?? "使用する数" }}：{{
          modelValue.filter((id) => g.items.some((i) => i.id === id)).length
        }}個</small
      >
      <QuantitySpinner
        :label="`${uiText(LABELS[g.kind] ?? recipe(g.kind)?.name ?? g.kind)}の数量`"
        ><input
          :aria-label="`${uiText(LABELS[g.kind] ?? recipe(g.kind)?.name ?? g.kind)}の数量`"
          type="number"
          inputmode="numeric"
          step="1"
          min="0"
          :max="g.items.length"
          :value="
            modelValue.filter((id) => g.items.some((i) => i.id === id)).length
          "
          @input="quantity(g.kind, $event.target as HTMLInputElement)"
      /></QuantitySpinner>
    </label>
    <p v-if="!groups.length">選択できる品物はありません。</p>
  </div>
</template>
<style scoped>
.grouped-items {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.75rem;
  margin: 1rem 0;
}
.grouped-items label {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
}
.grouped-items input {
  width: 100%;
  box-sizing: border-box;
}
</style>
