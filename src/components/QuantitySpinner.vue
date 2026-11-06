<script setup lang="ts">
import { ref } from "vue";
defineProps<{ label: string }>();
const root = ref<HTMLElement>();
function step(direction: number) {
  const input = root.value?.querySelector("input");
  if (!input || input.disabled || input.readOnly) return;
  const before = input.value;
  if (!input.value) input.value = "0";
  if (direction > 0) input.stepUp();
  else input.stepDown();
  if (input.value !== before)
    input.dispatchEvent(new Event("input", { bubbles: true }));
}
</script>
<template>
  <span ref="root" class="quantity-spinner">
    <slot />
    <button type="button" :aria-label="`${label}を増やす`" @click="step(1)">
      ＋
    </button>
    <button type="button" :aria-label="`${label}を減らす`" @click="step(-1)">
      −
    </button>
  </span>
</template>
<style scoped>
.quantity-spinner {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 32px;
  gap: 2px;
  min-width: 0;
}
.quantity-spinner :deep(input) {
  grid-row: span 2;
  width: 100%;
  max-width: none;
  min-width: 0;
  margin: 0;
}
button {
  min-width: 0;
  min-height: 24px;
  padding: 0;
  line-height: 1;
}
@media (max-width: 600px) {
  .quantity-spinner {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .quantity-spinner :deep(input) {
    grid-column: span 2;
    grid-row: auto;
    min-height: 44px;
  }
  button {
    min-height: 44px;
  }
}
</style>
