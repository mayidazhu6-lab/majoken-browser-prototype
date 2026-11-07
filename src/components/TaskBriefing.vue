<script setup lang="ts">
import GameIcon from "./GameIcon.vue";
defineProps<{
  graduation: boolean;
  midpoint?: { early: number; late: number };
  day: number;
  name: string;
  condition: string;
}>();
defineEmits<{ confirm: [] }>();
</script>
<template>
  <section class="panel focus-screen briefing">
    <section
      v-if="midpoint && !graduation"
      class="midpoint-notice"
      aria-label="後半戦の案内"
    >
      <div class="midpoint-heading">
        <span class="eyebrow"
          ><GameIcon kind="book" />魔女学校からのお知らせ</span
        ><span class="midpoint-seal" aria-hidden="true"
          ><GameIcon kind="star"
        /></span>
      </div>
      <h2 tabindex="-1">後半戦開幕！</h2>
      <p class="midpoint-subtitle">
        研究生活も残り4日。首席を目指す戦いは、ここからさらに激しくなる！
      </p>
      <h3>公開決闘の勝利報酬がアップ！</h3>
      <div class="midpoint-rewards" aria-label="公開決闘の勝利報酬">
        <div>
          <small>1〜4日目</small><span>勝利すると</span
          ><strong>+{{ midpoint.early }}FP</strong>
        </div>
        <span class="midpoint-arrow" aria-hidden="true">→</span>
        <div class="midpoint-late">
          <small>5〜8日目</small><span>勝利すると</span
          ><strong>+{{ midpoint.late }}FP</strong>
        </div>
      </div>
      <p class="midpoint-scope">
        挑戦側・被挑戦側、どちらが勝っても適用されます。公開決闘のみの報酬です。イベント模擬戦や秘匿行動の襲撃などの報酬は変わりません。
      </p>
    </section>
    <h2 tabindex="-1">
      <GameIcon kind="book" />
      {{ graduation ? "あなたの卒業課題" : `${day}日目の今日の課題` }}
    </h2>
    <p v-if="graduation">8日間の間に以下を達成する事。</p>
    <h3>{{ name }}</h3>
    <p>達成条件：{{ condition }}</p>
    <p v-if="graduation">
      卒業課題を達成した魔女が卒業します。卒業者のうち名声（FP）が最も高い魔女が首席です。共通イベントに通算3回失敗すると全員敗北です。
    </p>
    <p v-else>達成報酬：名声（FP）+1。夜の結果確認後に判定します。</p>
    <button class="primary" @click="$emit('confirm')">
      {{ midpoint && !graduation ? "確認して進む" : "確認した" }}
    </button>
  </section>
</template>
