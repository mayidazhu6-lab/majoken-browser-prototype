<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
const root = ref<HTMLElement>();
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(() =>
    document.documentElement.style.setProperty(
      "--turn-hud-height",
      `${root.value?.getBoundingClientRect().height ?? 0}px`,
    ),
  );
  if (root.value) observer.observe(root.value);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  document.documentElement.style.removeProperty("--turn-hud-height");
});
defineProps<{
  day: number;
  phase: string;
  time: string;
  ap: number;
  fp: number;
  publicPhase: boolean;
  acted: boolean;
  ownTurn: boolean;
  reason: string;
}>();
</script>
<template>
  <section ref="root" class="turn-hud" aria-label="現在の時間帯と行動点">
    <div class="hud-time">
      <strong>第{{ day }}日 · {{ time }}</strong
      ><small>{{ phase }}</small>
    </div>
    <div class="hud-ap">
      <span class="ap-tokens" aria-hidden="true"
        ><i v-for="n in 2" :key="n" :class="{ spent: n > ap }"></i
      ></span>
      <strong>残りAP {{ ap }} / 2</strong>
      <small v-if="publicPhase">{{
        ownTurn
          ? acted
            ? "この時間帯は行動済み"
            : "あなたの手番"
          : "公開行動の進行待ち"
      }}</small>
      <small v-else>公開行動用のAP</small>
    </div>
    <div class="hud-personal">
      <small>あなたの名声</small><strong>{{ fp }} FP</strong>
    </div>
    <p class="hud-reason" v-if="reason">{{ reason }}</p>
  </section>
</template>
