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

/** Navigate presentation-only steps; never acknowledge a game result dialog. */
export async function settleScreens(page: Page) {
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(20);
    const later = page.getByRole("button", { name: "後で返答", exact: true });
    if (await later.isVisible()) {
      await later.click();
      continue;
    }
    if (await page.getByRole("dialog").isVisible()) return;
    const card = page.locator(".briefing, .action-result");
    if (await card.isVisible()) {
      await card.getByRole("button", { name: "確認した", exact: true }).click();
      continue;
    }
    let moved = false;
    for (const label of [
      "行動選択へ",
      "判定結果を見る",
      "次のラウンドへ",
      "戦闘終了へ",
      "戦闘結果を確認",
    ]) {
      const button = page.getByRole("button", { name: label, exact: true });
      if (await button.isVisible()) {
        await button.click();
        moved = true;
        break;
      }
    }
    if (!moved) return;
  }
}

export async function expectGoalProgress(page: Page, text: string | RegExp) {
  await page.getByRole("button", { name: /📜/ }).click();
  await (
    await import("@playwright/test")
  )
    .expect(page.getByRole("dialog", { name: "課題", exact: true }))
    .toContainText(text);
  await page
    .getByRole("dialog", { name: "課題", exact: true })
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
}
