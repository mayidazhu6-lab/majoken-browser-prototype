import { LABELS, MATERIALS } from "../domain/config";
import { createGame, dispatch } from "../domain/reducer";
import { isMaterial } from "../domain/items";
import { elementPotion } from "../domain/elementCombat";
import { nightRecipe } from "../domain/night";
import type { Action, GameState, Item, Log } from "../domain/types";

export type ItemChange = { cause: string; kind: string; amount: number };
export const visibleToMe = (l: Log) =>
  l.audience === "public" ||
  (Array.isArray(l.audience) && l.audience.includes(0));
export function inventoryCounts(items: Item[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  return counts;
}
const delta = (before: Record<string, number>, after: Record<string, number>) =>
  Object.fromEntries(
    [...new Set([...Object.keys(before), ...Object.keys(after)])].map(
      (kind) => [kind, (after[kind] ?? 0) - (before[kind] ?? 0)],
    ),
  );

/** Explain only confirmed records. Unrecorded causes remain explicitly unattributed. */
export function itemChanges(
  before: GameState,
  after: GameState,
  action: Action,
  day: number,
): ItemChange[] {
  const logs = after.logs
    .slice(before.logs.length)
    .filter((l) => l.day === day && visibleToMe(l));
  const changes: ItemChange[] = [];
  const add = (cause: string, kind: string, amount: number) => {
    if (!amount) return;
    const row = changes.find(
      (row) =>
        row.cause === cause &&
        row.kind === kind &&
        Math.sign(row.amount) === Math.sign(amount),
    );
    if (row) row.amount += amount;
    else changes.push({ cause, kind, amount });
  };
  const removed = before.players[0].inventory.filter(
    (i) => !after.players[0].inventory.some((j) => j.id === i.id),
  );
  const prefix = (l: Log) =>
    ["public", "magic", "vote"].includes(l.phase) ? "公開行動" : "夜間行動";
  let previousTrade = -2;
  for (const l of logs) {
    if (l.type === "gatherItems" && l.actor === 0) {
      for (const name of l.text.split("・")) {
        const kind = MATERIALS.find((kind) => LABELS[kind] === name);
        if (kind) add("公開行動・採集", kind, 1);
      }
    }
    if (l.type === "research" && l.actor === 0) {
      for (const item of removed.filter((i) => isMaterial(i.kind) && !i.lock))
        add("公開行動・研究", item.kind, -1);
    }
    if (l.type === "brew" && l.actor === 0 && l.kind) {
      const r = nightRecipe(l.kind);
      if (r) {
        for (const kind of r.materials)
          add("夜間行動・調合", kind, -(l.amount ?? 1));
        add("夜間行動・調合", r.id, l.amount ?? 1);
      }
    }
    if (
      l.type === "usePotion" &&
      l.actor === 0 &&
      l.kind &&
      !elementPotion(l.kind) &&
      nightRecipe(l.kind)?.level !== 1
    )
      add(prefix(l) + "・薬の使用", l.kind, -1);
    if (l.type === "loot" && l.kind && (l.actor === 0 || l.target === 0))
      add(
        l.actor === 0 ? "夜間行動・強奪" : "夜間行動・強奪被害",
        l.kind,
        (l.actor === 0 ? 1 : -1) * (l.amount ?? 1),
      );
    if (l.type === "trade" && (l.actor === 0 || l.target === 0)) {
      // Both participants receive a trade record with the same original orientation.
      if (l.seq === previousTrade + 1) {
        previousTrade = -2;
        continue;
      }
      previousTrade = l.seq;
      const sign = l.actor === 0 ? -1 : 1;
      for (const kind of (l.data?.offered ?? []) as string[])
        add("公開行動・取引", kind, sign);
      for (const kind of (l.data?.receivedKinds ?? []) as string[])
        add("公開行動・取引", kind, -sign);
    }
  }
  if (action.type === "usePotion" && action.player === 0) {
    for (const item of removed.filter((i) => i.id === action.item))
      add("公開行動・薬の使用", item.kind, -1);
  }
  if (action.type === "shop" && action.player === 0) {
    for (const item of before.players[0].inventory.filter((i) =>
      action.items.includes(i.id),
    ))
      add("公開行動・購買", item.kind, -1);
    add("公開行動・購買", action.receive, 1);
  }
  if (action.type === "loadout" && action.player === 0) {
    for (const item of removed.filter((i) => action.items.includes(i.id)))
      add("戦闘・薬の持ち込み", item.kind, -1);
  }
  if (!before.event.resolved && after.event.resolved && after.event.success) {
    if (after.event.mock.includes(0)) {
      for (const item of after.players[0].inventory.filter(
        (i) => i.id >= before.nextItem,
      ))
        add("公開行動・模擬戦報酬", item.kind, 1);
    }
    for (const item of removed.filter((i) => i.lock === "event"))
      add("公開行動・納品", item.kind, -1);
  }
  if (
    logs.some(
      (l) => l.type === "surrender" && (l.actor === 0 || l.target === 0),
    ) &&
    after.publicOutcome
  ) {
    for (const kind of after.publicOutcome.items)
      add(
        "公開行動・降参品の移動",
        kind,
        after.publicOutcome.from === 0 ? 1 : -1,
      );
  }
  const actual = delta(
    inventoryCounts(before.players[0].inventory),
    inventoryCounts(after.players[0].inventory),
  );
  for (const row of changes)
    actual[row.kind] = (actual[row.kind] ?? 0) - row.amount;
  for (const [kind, amount] of Object.entries(actual))
    add("内訳記録のない増減", kind, amount);
  return changes;
}

const fpCauses: Record<string, string> = {
  duel: "公開決闘の勝利",
  event: "共通イベント",
  ho: "今日の課題達成",
  scout: "夜間行動による名声減少",
};
export function fpChanges(logs: Log[], day: number) {
  return logs
    .filter(
      (l) =>
        l.day === day &&
        visibleToMe(l) &&
        l.type === "fp" &&
        l.actor === 0 &&
        (l.amount ?? 0) !== 0,
    )
    .map((l) => ({
      cause: fpCauses[l.kind ?? ""] ?? "名声の増減（内訳記録なし）",
      amount: l.amount ?? 0,
      seq: l.seq,
    }));
}
/** Replay an isolated copy for UI derivation; never publish or save its state/logs. */
export function dailyReview(s: GameState) {
  const day = s.day;
  const fpEntries = fpChanges(s.logs, day);
  let replayed = createGame(
    JSON.parse(JSON.stringify(s.setup)),
    s.rulesVersion,
  );
  let start = replayed.players[0];
  const items: ItemChange[] = [];
  let found = day === 1;
  let error = "";
  try {
    for (const action of s.actions) {
      const before = replayed;
      replayed = dispatch(before, action);
      if (before.day === day || replayed.day === day) {
        if (!found) {
          start = before.players[0];
          found = true;
        }
        items.push(...itemChanges(before, replayed, action, day));
      }
    }
    if (
      !found ||
      JSON.stringify(replayed.players[0].inventory) !==
        JSON.stringify(s.players[0].inventory) ||
      replayed.players[0].fp !== s.players[0].fp ||
      replayed.rng !== s.rng ||
      replayed.draws !== s.draws
    )
      throw Error("unmatched replay");
    if (
      fpEntries.reduce((sum, row) => sum + row.amount, 0) !==
      s.players[0].fp - start.fp
    )
      throw Error("unmatched FP records");
  } catch {
    error =
      "既存の操作記録と状態を照合できないため、増減の内訳を表示できません。";
  }
  const inventoryStart = inventoryCounts(start.inventory),
    inventoryEnd = inventoryCounts(s.players[0].inventory);
  const totals = delta(inventoryStart, inventoryEnd);
  for (const row of items) totals[row.kind] ??= 0;
  return {
    day,
    items: error ? [] : items,
    inventoryStart,
    inventoryEnd,
    totals,
    fpEntries,
    fpStart: start.fp,
    fpEnd: s.players[0].fp,
    error,
  };
}
