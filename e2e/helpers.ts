import type { Locator, Page } from "@playwright/test";
import type { GameState } from "../src/domain/types";
import { LABELS } from "../src/domain/config";
import { recipe } from "../src/domain/items";
export async function selectItems(
  root: Page | Locator,
  s: GameState,
  ids: number[],
) {
  const counts: Record<string, number> = {};
  for (const id of ids) {
    const kind = s.players[0].inventory.find((i) => i.id === id)!.kind;
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  for (const [kind, n] of Object.entries(counts))
    await root
      .getByLabel(`${LABELS[kind] ?? recipe(kind)?.name ?? kind}の数量`, {
        exact: true,
      })
      .fill(String(n));
}
