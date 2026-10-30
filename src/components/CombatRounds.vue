<script setup lang="ts">
import type { Combat } from "../domain/types";
import { CONFIG, LABELS } from "../domain/config";
import { recipe } from "../domain/items";
defineProps<{ combat: Combat; names: string[] }>();
</script>
<template>
  <div class="combat-rounds">
    <table>
      <caption>
        左：仕掛けた魔女 / 右：仕掛けられた魔女
      </caption>
      <thead>
        <tr>
          <th>R</th>
          <th v-for="(name, side) in names" :key="side" :data-side="side">
            {{ name }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(round, index) in combat.rounds" :key="index">
          <th>{{ index + 1 }}</th>
          <td v-for="side in [0, 1]" :key="side" :data-side="side">
            <strong
              >{{ LABELS[round.choices[side]] }} · 判定
              {{ round.values[side] }}</strong
            >
            <p>
              基礎 {{ round.base[side] }} ＋ 1D6 {{ round.rolls[side] }} ＋
              ため補正 {{ round.chargeBonus[side] }} ＋ 警戒
              {{ round.guard[side] }}
            </p>
            <p>
              薬
              {{
                round.potions[side]
                  ? recipe(round.potions[side]!)?.name
                  : "なし"
              }}
              · 補正（攻/防/ため）{{ round.buffs[side].attack }}/{{
                round.buffs[side].defense
              }}/{{ round.buffs[side].charge }}
            </p>
            <p>
              被ダメージ {{ round.damage[side] }} · HP
              {{ index === 0 ? CONFIG.hp : combat.rounds[index - 1].hp[side] }}
              → {{ round.hp[side] }}
            </p>
            <p>
              カウンター：{{ round.counter[side] ? "発生" : "なし" }} · 洞察
              {{ round.insight[side] }} · 次Rため {{ round.nextCharge[side] }}
            </p>
            <small
              v-if="
                round.choices[side] === 'charge' &&
                index + 1 === CONFIG.maxRounds
              "
              >最終ラウンドのためるは強化効果を発揮しません。</small
            >
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
