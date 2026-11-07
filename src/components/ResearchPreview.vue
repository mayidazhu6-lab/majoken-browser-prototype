<script setup lang="ts">
import GameIcon from "./GameIcon.vue";
import { isV20 } from "../domain/config";
import { computed } from "vue";
import type { Stat } from "../domain/types";
import { researchOutcome } from "../ui/attributes";

const props = defineProps<{
  stat: Stat;
  value: number;
  growth: number;
  scholarship: boolean;
  rulesVersion: string;
  recipes: readonly string[];
}>();

const preview = computed(() =>
  researchOutcome(props, props.stat, props.value, props.growth, props.recipes),
);
</script>

<template>
  <div class="research-preview" aria-live="polite">
    <strong
      ><GameIcon
        :kind="stat"
        :legacy="!isV20({ rulesVersion })"
      />研究が成立した場合</strong
    >
    <p>
      恒久能力値 {{ value }} → {{ preview.after }}（＋{{ growth
      }}<template v-if="scholarship">、研鑽の薬 ＋1込み</template>）
    </p>
    <p>Lv{{ preview.beforeLevel }} → Lv{{ preview.afterLevel }}</p>
    <template v-if="preview.gains.length">
      <strong>Lvアップで増える効果</strong>
      <ul>
        <li v-for="gain in preview.gains" :key="gain">{{ gain }}</li>
      </ul>
    </template>
  </div>
</template>
