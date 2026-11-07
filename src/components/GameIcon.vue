<script setup lang="ts">
import { computed } from "vue";
import { iconDefinition, shapes } from "../ui/iconCatalog";
const props = withDefaults(
  defineProps<{ kind: string; legacy?: boolean; label?: string }>(),
  { legacy: false },
);
const icon = computed(() => iconDefinition(props.kind, props.legacy));
</script>
<template>
  <svg
    class="game-icon"
    viewBox="0 0 32 32"
    width="32"
    height="32"
    :data-icon="kind"
    :data-symbol="icon.shape"
    :data-mark="icon.mark"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : true"
    focusable="false"
    :style="{ color: `var(--icon-${icon.tone}, currentColor)` }"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path :d="shapes[icon.shape]" fill="currentColor" fill-opacity=".12" />
    <path
      v-if="icon.mark"
      :d="shapes[icon.mark]"
      transform="translate(9 14) scale(.44)"
      stroke-width="3.5"
    />
  </svg>
</template>
