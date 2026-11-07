<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ failed: number }>();
const remaining = computed(() => Math.max(0, 3 - props.failed));
</script>
<template>
  <section
    class="institute-health risk"
    :class="{ danger: remaining <= 1 }"
    aria-label="研究所の残り耐久"
  >
    <div class="health-heading">
      <strong>研究所の耐久</strong><b>{{ remaining }} / 3</b>
    </div>
    <meter
      min="0"
      max="3"
      :value="remaining"
      :aria-label="`研究所の耐久 ${remaining} / 3`"
    ></meter>
    <p>
      {{
        remaining === 0
          ? "研究所崩壊"
          : remaining === 1
            ? "次に失敗すると崩壊"
            : `あと${remaining}回の失敗で研究所崩壊`
      }}
    </p>
    <details>
      <summary>失敗数と崩壊条件</summary>
      <small>累積失敗 {{ failed }} / 3。通算3回の失敗で全員敗北します。</small>
    </details>
  </section>
</template>
