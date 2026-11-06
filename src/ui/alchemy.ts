import type { Player } from "../domain/types";
import { MATERIALS } from "../domain/config";
import { recipe } from "../domain/items";

/** Read-only preview; the reducer remains responsible for crafting validation. */
export function plannedMaterials(player: Player, plan: string[]) {
  return MATERIALS.map((kind) => {
    const owned = player.inventory.filter((i) => i.kind === kind).length;
    const reserved = player.inventory.filter(
      (i) => i.kind === kind && i.lock,
    ).length;
    const planned = plan.reduce(
      (n, id) =>
        n + (recipe(id)?.materials.filter((m) => m === kind).length ?? 0),
      0,
    );
    return {
      kind,
      owned,
      reserved,
      planned,
      remaining: owned - planned,
      available: owned - reserved - planned,
    };
  });
}
export function potionDescription(kind: string) {
  const r = recipe(kind);
  if (!r) return "";
  switch (r.effect) {
    case "gather":
      return `採集の獲得数 +${r.power}（採集と同時に1個使用）`;
    case "research":
      return `研究の成長 +${r.power}（研究と同時に1個使用）`;
    case "cleanse":
      return r.tier === "special"
        ? "呪詛を解除し、その夜の呪詛も無効化（公開行動・固有魔法フェーズで手動使用）"
        : "呪詛を受けた夜、1個を自動消費して呪詛を解除";
    case "guard":
      return `警戒中に襲撃された戦闘の初回防御判定 +${r.power}（警戒と同時に使用）`;
    case "scout":
      return r.power >= 999
        ? "偵察対象のアイテムをすべて確認（通常の確認数上限なし。襲撃・警戒中の対象には既存の減点処理）"
        : `偵察でアイテムを最大${r.power}個確認（影渡り使用時はさらに2個。襲撃・警戒中の対象には既存の減点処理）`;
    case "attack":
      return `戦闘の攻撃判定 +${r.power}（使用したラウンドのみ。持込には洞察Lv3が必要）`;
    case "defense":
      return `戦闘の防御判定 +${r.power}（使用したラウンドのみ。持込には洞察Lv3が必要）`;
    case "charge":
      return `戦闘のためる判定 +${r.power}（次ラウンドの強化値に加算。持込には洞察Lv3が必要）`;
    case "change":
      return "固有魔法を別の魔法へ変更（翌日から反映。第1〜7日の固有魔法フェーズで、ゲーム中1回のみ）";
  }
}
