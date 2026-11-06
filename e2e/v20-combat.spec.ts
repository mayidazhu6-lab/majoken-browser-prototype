import { expect, test } from "@playwright/test";
import { settleScreens } from "./helpers";

for (const [seed, action, title] of [
  ["v20-battle-36", "公開決闘 1AP", "公開決闘"],
  ["v20-battle-36", "イベント模擬戦 0AP", "公開模擬戦"],
  ["v20-battle-6", "イベント模擬戦 0AP", "公開模擬戦"],
]) {
  test(`${seed} の ${title}を属性で決着できる`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /ゲーム開始/ }).click();
    await page.getByLabel(/乱数シード/).fill(seed);
    await page
      .getByRole("button", { name: /公開行動の試遊をはじめる/ })
      .click();
    await settleScreens(page);
    await page.getByRole("button", { name: "決闘", exact: true }).click();
    await page.getByRole("button", { name: action }).click();
    const battle = page.locator(".combat-panel");
    await expect(battle.getByRole("heading", { name: title })).toBeVisible();
    await expect(battle.getByRole("status")).toContainText("HP 12");
    if (title === "公開決闘")
      await battle.getByRole("button", { name: "持ち込まずに進む" }).click();
    else
      await expect(
        battle.getByText("模擬戦では上位薬を使用しません。"),
      ).toBeVisible();
    await battle.getByRole("button", { name: "水", exact: true }).click();
    const confirmRound = battle.getByRole("button", { name: "属性と薬を確定" });
    await confirmRound.click();
    await expect(battle.getByText(/水 · 与ダメージ/)).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "続きから" }).click();
    await expect(battle.getByText(/水 · 与ダメージ/)).toBeVisible();
    for (let i = 1; i < 5 && (await confirmRound.isVisible()); i++)
      await confirmRound.click();
    await battle.getByRole("button", { name: "確認した" }).click();
    await expect(battle).toHaveCount(0);
  });
}
