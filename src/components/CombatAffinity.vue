<script setup lang="ts">
import { useId } from "vue";
import GameIcon from "./GameIcon.vue";
import type { Stat } from "../domain/types";
defineProps<{ elemental: boolean; selected?: Stat }>();
const marker = `affinity-${useId()}`;
const nodes = [
  { stat: "attack", name: "火", x: 160, y: 34 },
  { stat: "insight", name: "風", x: 264, y: 180 },
  { stat: "defense", name: "水", x: 56, y: 180 },
] as const;
const edges = [
  { from: "attack", to: "insight", path: "M198 76 236 134" },
  { from: "insight", to: "defense", path: "M222 180H98" },
  { from: "defense", to: "attack", path: "M84 134 122 76" },
] as const;
</script>
<template>
  <aside class="combat-affinity" aria-label="戦闘の相性">
    <template v-if="elemental">
      <figure class="affinity-figure">
        <svg
          class="affinity-triangle"
          viewBox="0 0 320 220"
          role="img"
          aria-label="属性相性：火は風に、風は水に、水は火に有利"
        >
          <defs>
            <marker
              :id="marker"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0 0 10 5 0 10Z" fill="var(--gold)" />
            </marker>
          </defs>
          <path
            v-for="edge in edges"
            :key="edge.from"
            :d="edge.path"
            :data-from="edge.from"
            :data-to="edge.to"
            class="affinity-edge"
            :class="{
              outgoing: selected === edge.from,
              incoming: selected === edge.to,
            }"
            :marker-end="`url(#${marker})`"
          />
          <g
            v-for="node in nodes"
            :key="node.stat"
            :data-element="node.stat"
            :data-selected="selected === node.stat"
            class="affinity-node"
          >
            <rect
              :x="node.x - 36"
              :y="node.y - 33"
              width="72"
              height="66"
              rx="16"
            />
            <GameIcon
              :kind="node.stat"
              :x="node.x - 14"
              :y="node.y - 26"
              width="28"
              height="28"
              class="diagram-icon"
            />
            <text :x="node.x" :y="node.y + 22" text-anchor="middle">
              {{ node.name }}
            </text>
          </g>
        </svg>
        <figcaption>矢印の先に有利：火 → 風 → 水 → 火</figcaption>
      </figure>
      <div class="affinity-guide">
        <strong>属性の相性</strong>
        <div class="affinity-bonuses">
          <span>有利 ＋1</span><span>不利 −1</span><span>同属性 0</span>
        </div>
        <details>
          <summary>ダメージ補正の詳しい説明</summary>
          <p>
            有利なら与えるダメージ＋1、不利なら−1。同じ属性は相性補正0。双方のダメージを同時に反映します。Lvや薬の補正も加わるため、相性だけで勝敗は決まりません。
          </p>
        </details>
      </div>
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
