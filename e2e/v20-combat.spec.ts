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
    await page.getByRole("checkbox", { name: "開発者モード" }).check();
    await page.getByLabel(/乱数シード/).fill(seed);
    await page.getByRole("button", { name: "研究開始", exact: true }).click();
    await settleScreens(page);
    await page
      .getByRole("button", { name: "決闘（1AP）", exact: true })
      .click();
    if (title === "公開模擬戦") {
      await page
        .getByRole("button", {
          name: "イベント模擬戦に切り替える",
          exact: true,
        })
        .click();
      await page.getByRole("combobox", { name: "対戦相手" }).selectOption("1");
    }
    await page.getByRole("button", { name: action }).click();
    const battle = page.locator(".combat-panel");
    await expect(battle.getByRole("heading", { name: title })).toBeVisible();
    await expect(battle.getByRole("status")).toContainText("HP 12");
    await expect(battle.locator(".duel-fighter").first()).toContainText(
      "アリア",
    );
    await expect(battle.locator(".duel-fighter").last()).toContainText(
      /火.*水.*風/,
    );
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

test("届いた決闘はモーダルで応答し、受ける側でも自分が左になる", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /ゲーム開始/ }).click();
  await page.getByRole("checkbox", { name: "開発者モード" }).check();
  await page.getByLabel(/乱数シード/).fill("v20-finish-0");
  await page.getByRole("button", { name: "研究開始", exact: true }).click();
  await settleScreens(page);
  await page.getByRole("button", { name: /手番終了 \/ パス/ }).click();
  const challenge = page.getByRole("dialog", { name: /から公開決闘の挑戦/ });
  await expect(challenge).toBeVisible();
  const challenger = (await challenge
    .getByRole("heading")
    .textContent())!.split("から")[0];
  await challenge
    .getByRole("button", { name: "対戦する", exact: true })
    .click();
  const fighters = page.locator(".duel-fighter");
  await expect(fighters.first()).toContainText("アリア");
  await expect(fighters.last()).toContainText(challenger);
  await expect(fighters.last()).toContainText(/HP 12.*火.*水.*風/);
});
