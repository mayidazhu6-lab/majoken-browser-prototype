<script setup lang="ts">
import { computed } from "vue";
import BlockingDialog from "./BlockingDialog.vue";
import { ruleGuide } from "../ui/ruleGuide";

const props = defineProps<{ rulesVersion: string; opener: HTMLElement }>();
defineEmits<{ close: [] }>();
const sections = computed(() => ruleGuide(props.rulesVersion));
</script>

<template>
  <BlockingDialog
    title="遊び方・ルール説明"
    :return-focus="opener"
    dismissible
    @close="$emit('close')"
  >
    <div class="rule-guide">
      <p class="muted">ルール {{ rulesVersion.replace("browser-", "v") }}</p>
      <details
        v-for="(section, index) in sections"
        :key="section.title"
        :open="index === 0"
      >
        <summary>{{ section.title }}</summary>
        <component :is="section.ordered ? 'ol' : 'ul'" v-if="section.items">
          <li v-for="item in section.items" :key="item.label">
            <strong>{{ item.label }}</strong>
            <p>{{ item.text }}</p>
          </li>
        </component>
        <p v-for="paragraph in section.paragraphs" :key="paragraph">
          {{ paragraph }}
        </p>
      </details>
    </div>
    <template #actions>
      <button class="primary" @click="$emit('close')">閉じる</button>
    </template>
  </BlockingDialog>
</template>
