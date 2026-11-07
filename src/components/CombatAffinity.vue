<script setup lang="ts">
defineProps<{ elemental: boolean }>();
</script>
<template>
  <aside class="combat-affinity" aria-label="戦闘の相性">
    <template v-if="elemental">
      <strong>属性の相性 · 矢印の先に有利</strong>
      <div class="affinity-links">
        <span>🔥 火 → 🍃 風</span><span>🍃 風 → 💧 水</span
        ><span>💧 水 → 🔥 火</span>
      </div>
      <p>
        有利なら与えるダメージ＋1、不利なら−1。同じ属性は相性補正0。双方のダメージを同時に反映します。Lvや薬の補正も加わるため、相性だけで勝敗は決まりません。
      </p>
    </template>
    <template v-else>
      <strong>手の関係（旧ルール）</strong>
      <p>
        攻撃 × 攻撃：互いにダメージ。攻撃 ×
        防御：数値を比較し、防御側が上回れば反撃。攻撃 ×
        ためる：ためる側がダメージを受けます。
      </p>
      <p>
        ためる：次の攻撃・防御を強化（連続・最終ラウンドは不可）。幻惑：特定のラウンドで相手の手が変更されます。能力値・出目・薬でも結果が変わり、固定の三すくみではありません。
      </p>
    </template>
  </aside>
</template>
