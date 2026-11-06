<script setup lang="ts">
import { computed } from "vue";
import { level, nextLevel } from "../domain/config";
import type { Stat } from "../domain/types";
import { attributeEffects, attributeGains } from "../ui/attributes";

const props = defineProps<{
  stat: Stat;
  label: string;
  value: number;
  rulesVersion: string;
  recipes: readonly string[];
}>();

const current = computed(() => level(props.value));
const threshold = computed(() => nextLevel(props.value));
const effects = computed(() =>
  attributeEffects(props, props.stat, current.value, props.recipes),
);
const gains = computed(() =>
  threshold.value === null
    ? []
    : attributeGains(
        props,
        props.stat,
        current.value,
        level(threshold.value),
        props.recipes,
      ),
);
</script>

<template>
  <section class="attribute-details" :data-stat="stat">
    <h4>{{ label }} · 恒久能力値 {{ value }} / Lv{{ current }}</h4>
    <p>現在の効果</p>
    <ul>
      <li v-for="effect in effects" :key="effect">{{ effect }}</li>
    </ul>
    <p v-if="threshold !== null">
      Lv{{ current + 1 }}まであと{{ threshold - value }}点（能力値{{
        threshold
      }}）
    </p>
    <p v-else>最高Lvです</p>
    <ul v-if="gains.length">
      <li v-for="gain in gains" :key="gain">{{ gain }}</li>
    </ul>
  </section>
</template>
