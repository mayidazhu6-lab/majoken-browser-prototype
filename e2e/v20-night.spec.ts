import { expect, test } from "@playwright/test";
import { settleScreens } from "./helpers";

test("秘匿決闘の入力確定後と強奪の選択前後に再開する", async ({ page }) => {
  const reload = async () => {
    await page.reload();
    await page.getByRole("button", { name: "続きから" }).click();
  };
  await page.goto("/");
  await page.getByRole("button", { name: /ゲーム開始/ }).click();
  await page.getByLabel(/乱数シード/).fill("night-2");
  await page.getByRole("button", { name: /公開行動の試遊をはじめる/ }).click();
  await settleScreens(page);
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "採集", exact: true }).click();
    await page.getByRole("button", { name: "採集 1AP" }).click();
    await settleScreens(page);
    await page.getByRole("button", { name: /手番終了 \/ パス/ }).click();
  }
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "確認した" })
    .click();
  await page.getByRole("button", { name: /秘匿行動へ/ }).click();
  if (
    await page.getByRole("heading", { name: /予知の投票 · 明日/ }).isVisible()
  ) {
    const vote = page.locator(".panel").filter({
      has: page.getByRole("heading", { name: /予知の投票 · 明日/ }),
    });
    await vote.getByRole("button").first().click();
    await page.getByRole("button", { name: /投票を締め切る/ }).click();
  }
  const night = page.locator(".night-panel");
  const actions = night.getByRole("group", { name: "夜間行動" });
  await expect(actions.getByRole("button")).toHaveCount(5);
  await night.getByText("すべての薬の効果").click();
  await expect(
    night.getByText("呪詛を受けたとき、自動で1個消費", { exact: false }),
  ).toBeVisible();
  await actions.getByRole("button", { name: "襲撃", exact: true }).click();
  await night.getByLabel("対象").selectOption("2");
  await night.getByRole("button", { name: "夜間行動と錬金を確定" }).click();
  await settleScreens(page);
  await page.getByRole("button", { name: /秘匿行動を解決/ }).click();
  const combat = page.locator(".combat-panel");
  await expect(combat.getByRole("heading", { name: "秘匿決闘" })).toBeVisible();
  await combat.getByRole("button", { name: "持ち込まずに進む" }).click();
  const choose = combat.getByRole("button", { name: "属性と薬を確定" });
  const result = combat.getByRole("button", { name: "ラウンド結果を見る" });
  await combat.getByRole("button", { name: "水", exact: true }).click();
  await choose.click();
  await reload();
  await expect(
    combat.getByText("あなたの属性と薬は確定済みです。"),
  ).toBeVisible();
  await result.click();
  await expect(combat.getByText(/水 · 与ダメージ/)).toBeVisible();
  for (let i = 1; i < 5 && (await choose.isVisible()); i++) {
    await combat.getByRole("button", { name: "水", exact: true }).click();
    await choose.click();
    await result.click();
  }
  await combat.getByRole("button", { name: "確認した" }).click();
  const reward = page.locator(".night-reward");
  await expect(reward).toBeVisible();
  await reload();
  await reward
    .getByRole("button", { name: /^強奪：/ })
    .first()
    .click();
  await reload();
  await expect(reward).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /今日の課題を判定/ }),
  ).toBeVisible();
});
