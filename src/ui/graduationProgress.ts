import { duelHistory } from "../domain/duelHistory";
import type { GameState } from "../domain/types";
import { LABELS, STATS, V20_LABELS, hasFinalGoalRules } from "../domain/config";

/** A partial progress view based on the player's records and public counts only. */
export function graduationProgress(s: GameState): string[] {
  const modern = hasFinalGoalRules(s);
  const p = s.players[0],
    target = p.longGoal.targets[0];
  const logs = s.logs.filter(
    (l) =>
      l.actor === 0 &&
      (l.audience === "public" ||
        (Array.isArray(l.audience) && l.audience.includes(0))),
  );
  const entries = (type: string, to?: number) =>
    logs.filter(
      (l) => l.type === type && (to === undefined || l.target === to),
    );
  const count = (type: string, to?: number) =>
    entries(type, to).reduce((n, l) => n + (l.amount ?? 1), 0);
  const battles = duelHistory(s).filter((c) => c.participants.includes(0));
  const wins = (to?: number) =>
    battles.filter(
      (c) => c.winner === 0 && (to === undefined || c.opponents.includes(to)),
    ).length;
  const scouts = (to?: number) =>
    entries("scout", to).filter((l) => (l.amount ?? 0) > 0);
  const trade = `指定相手との取引 ${entries("trade", target).length}回`;
  const victory = `指定相手への勝利 ${wins(target)}回`;
  const names = s.players.slice(1);
  switch (p.longGoal.id) {
    case 1:
      return [`あなたの名声（FP）${p.fp}。終了時の名声差で判定します。`];
    case 2:
      return [trade + " / 必要2回", victory + " / 必要1回"];
    case 3:
      return names.map(
        (q) => `${q.name}から累計受取 ${count("receive", q.id)} / 2個`,
      );
    case 5:
      return [victory + " / 必要2回"];
    case 6:
      return [
        `あなたの有効貢献 ${entries("contribution").length}イベント。終了時に全員と比較します。`,
      ];
    case 7:
      return [
        `指定相手への成功偵察 ${modern ? new Set(scouts(target).map((l) => l.day)).size : scouts(target).length} / 2回`,
        trade + " / 必要1回",
      ];
    case 8:
      return [`取引で渡した薬 ${count("givePotion")} / 3個`];
    case 9:
      return [
        `あなたのアイテム ${p.inventory.length}個 / 指定相手 ${s.players[target]?.inventory.length ?? 0}個。最終日の所持数で判定します。`,
      ];
    case 10:
      return [
        `命令を実行させた相手 ${
          new Set(
            entries("commandExecuted")
              .filter((l) => !modern || l.data?.qualifies === true)
              .map((l) => l.target),
          ).size
        } / 2人`,
      ];
    case 11:
      return [
        `指定相手への呪詛命中 ${entries("curseHit", target).length} / 1回`,
        victory + " / 必要1回",
      ];
    case 12:
      return [
        `取引後に成功偵察した相手 ${names.filter((q) => scouts(q.id).some((l) => entries("trade", q.id).some((t) => t.seq < l.seq))).length} / 2人`,
      ];
    case 13:
      return [
        `あなたが対戦した相手 ${names.filter((q) => battles.some((c) => c.opponents.includes(q.id))).length} / 3人（別条件：指定2人の公開決闘）`,
      ];
    case 16:
      return [
        `あなたの成功偵察 ${scouts().length}回、勝利 ${wins()}回。対象・実行順序を満たす必要があります。研究日誌で確認できます。`,
      ];
    case 17:
      return [
        `あなたの名声（FP）${p.fp}。公開決闘の敗北履歴と終了時の名声を使って判定します。`,
      ];
    case 18:
      return [
        `指定相手へ渡したアイテム ${count("give", target)} / 3個`,
        `あなたの名声（FP）${p.fp}。最多条件は終了時に判定します。`,
      ];
    case 19:
      return [
        victory + " / 必要2回",
        `指定相手への成功偵察 ${scouts(target).length} / 1回`,
      ];
    case 20:
      return [
        `防衛勝利 ${entries("defensiveWin").length} / 2回`,
        modern
          ? "第8日終了時に火・水・風のいずれかで単独最多も必要です。"
          : `現在の防御 ${p.stats.defense}（別条件：最終日に単独最多）`,
      ];
    case 21:
      return [
        `休息成功 ${new Set(entries("rest").map((l) => l.day)).size} / 3夜`,
      ];
    case 22:
      return STATS.map(
        (k) =>
          `${(modern ? V20_LABELS : LABELS)[k]} ${p.stats[k]}：現在${names.every((q) => q.stats[k] < p.stats[k]) ? "単独最多" : "単独最多ではありません"}（最終日に判定）`,
      );
    case 23:
      return [
        `使用・発動した薬 ${new Set(entries("usePotion").map((l) => l.kind)).size} / 3種類`,
      ];
    case 24:
      return [
        `敗北した相手 ${new Set(battles.filter((c) => c.winner !== null && c.winner !== 0).map((c) => c.opponents.find((id) => id !== 0))).size} / 2人`,
      ];
    case 25:
      return [
        `あなたのアイテム ${p.inventory.length} / 2個以下。全員中最少の条件は最終日に判定します。`,
      ];
    default:
      return ["最終日の条件を確認してください。"];
  }
}
