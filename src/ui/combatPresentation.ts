import type { Combat, Round } from "../domain/types";
import { LABELS } from "../domain/config";

/** Explain stored outcomes only: this module never rolls dice or resolves combat. */
export function roundReason(r: Round): string {
  const [a, b] = r.choices;
  if (a === "attack" && b === "attack")
    return "双方が攻撃したため、判定値の大小による勝敗比較はしません。それぞれ相手の攻撃判定値÷3（切り捨て、最低1）のダメージを受けます。";
  if (a !== "attack" && b !== "attack")
    return "双方とも攻撃を選んでいないため、ダメージはありません。ためるの判定値は次ラウンドの攻撃・防御へ加わります。";
  const attacker: 0 | 1 = a === "attack" ? 0 : 1;
  const defender: 0 | 1 = attacker === 0 ? 1 : 0;
  if (r.choices[defender] === "charge")
    return `攻撃 対 ためる：ためる側は無防備です。攻撃判定値${r.values[attacker]}−3（最低1）により${r.damage[defender]}ダメージ。ためる側の判定値とは比較しません。`;
  const diff = r.values[attacker] - r.values[defender];
  return (
    `攻撃${r.values[attacker]} 対 防御${r.values[defender]}。` +
    (diff < 0
      ? `防御が${-diff}上回ったためカウンター。攻撃側に${r.damage[attacker]}ダメージ（差1〜2は1、それ以上は差の値）。`
      : "防御は完全防御です。攻撃側の判定値が同じか上でも、防御側はダメージを受けません。")
  );
}
export function combatReason(c: Combat): string {
  if (!c.done) return "";
  return `${c.hp.some((h) => h <= 0) ? "HPが0になったため戦闘終了。" : "最大5ラウンドを終えたため戦闘終了。"}最終HP ${c.hp[0]} 対 ${c.hp[1]}。${c.winner === null ? "残りHPが同じなので引き分けです。" : "残りHPが多い魔女の勝利です。"}`;
}
export function revealedActions(r: Round, names: string[]): string {
  return r.choices
    .map(
      (v, i) =>
        `${names[i]}：${LABELS[v]}${r.original[i] !== v ? `（幻惑で${LABELS[r.original[i]]}から変更）` : ""}`,
    )
    .join(" / ");
}
