<script setup lang="ts">
defineProps<{
  graduation: boolean;
  day: number;
  name: string;
  condition: string;
}>();
defineEmits<{ confirm: [] }>();
</script>
<template>
  <section class="panel focus-screen briefing">
    <h2 tabindex="-1">
      {{ graduation ? "あなたの卒業課題" : `${day}日目の今日の課題` }}
    </h2>
    <p v-if="graduation">8日間の間に以下を達成する事。</p>
    <h3>{{ name }}</h3>
    <p>達成条件：{{ condition }}</p>
    <p v-if="graduation">
      卒業課題を達成した魔女が卒業します。卒業者のうち名声（FP）が最も高い魔女が首席です。共通イベントに通算3回失敗すると全員敗北です。
    </p>
    <p v-else>達成報酬：名声（FP）+1。夜の結果確認後に判定します。</p>
    <button class="primary" @click="$emit('confirm')">確認した</button>
  </section>
</template>
