import { expect, test } from "@playwright/test";
import { settleScreens } from "./helpers";

for (const [seed, expected] of [
  ["v20-smoke-1", "成功"],
  ["v20-smoke-20", "失敗"],
]) {
  test(`v2.0で公開2巡を完了し、イベント${expected}から再開できる`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem("majoken-save-v2"))
        localStorage.setItem("majoken-save-v2", "legacy-save");
    });
    await page.goto("/");
    await page.getByRole("button", { name: /ゲーム開始/ }).click();
    await page.getByLabel(/乱数シード/).fill(seed);
    await page
      .getByRole("button", { name: /公開行動の試遊をはじめる/ })
      .click();
    await settleScreens(page);
    for (let round = 1; round <= 2; round++) {
      await expect(page.locator(".persistent-turn")).toContainText(
        `第${round}巡`,
      );
      await page.getByRole("button", { name: "採集", exact: true }).click();
      await page.getByRole("button", { name: "採集 1AP" }).click();
      await settleScreens(page);
      await page.getByRole("button", { name: /手番終了 \/ パス/ }).click();
    }
    const result = page.getByRole("dialog");
    await expect(result).toContainText(expected);
    await page.reload();
    await page.getByRole("button", { name: "続きから" }).click();
    await expect(result).toContainText(expected);
    await result.getByRole("button", { name: "確認した" }).click();
    await expect(page.getByText("今夜、固有魔法を使いますか？")).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem("majoken-save-v2")),
    ).toBe("legacy-save");
  });
}
