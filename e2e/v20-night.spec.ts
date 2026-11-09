import { expect, test } from "@playwright/test";
import { settleScreens } from "./helpers";

for (const width of [1440, 390]) {
  test(`秘匿決闘から夜明け・翌日まで再開する ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const reload = async () => {
      await page.reload();
      await page.getByRole("button", { name: "続きから" }).click();
    };
    await page.goto("/");
    await page.getByRole("button", { name: /ゲーム開始/ }).click();
    await page.getByRole("checkbox", { name: "開発者モード" }).check();
    await page.getByLabel(/乱数シード/).fill("night-13");
    await page.getByRole("button", { name: "研究開始", exact: true }).click();
    await settleScreens(page);
    for (let i = 0; i < 2; i++) {
      await page
        .getByRole("button", { name: "採集（1AP）", exact: true })
        .click();
      await page.getByRole("button", { name: "採集 1AP" }).click();
      await settleScreens(page);
      await page.getByRole("button", { name: /手番終了 \/ パス/ }).click();
    }
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "確認した" })
      .click();
    await page.getByRole("button", { name: /秘匿行動へ/ }).click();
    await expect(
      page.getByRole("heading", { name: /予知.*明日のイベント/ }),
    ).toHaveCount(0);
    const night = page.locator(".night-panel");
    const actions = night.getByRole("group", { name: "夜間行動" });
    await expect(actions.getByRole("button")).toHaveText([
      "襲撃",
      "呪詛",
      "警戒",
      "休息",
      "偵察",
    ]);
    await night.getByText("すべての薬の効果").click();
    await expect(
      night.getByText("呪詛を受けたとき、自動で1個消費", { exact: false }),
    ).toBeVisible();
    const raid = actions.getByRole("button", { name: "襲撃", exact: true });
    await raid.click();
    await expect(raid).toHaveAttribute("aria-pressed", "true");
    await expect(night.locator(".night-effect")).toContainText("火Lv");
    await night.getByLabel("対象").selectOption("2");
    await night.getByRole("button", { name: "夜間行動と錬金を確定" }).click();
    await expect(page.locator(".action-result")).toHaveCount(0);
    await reload();
    await expect(page.locator(".action-result")).toHaveCount(0);
    await page.getByRole("button", { name: /秘匿行動を解決/ }).click();
    const combat = page.locator(".combat-panel");
    await expect(
      combat.getByRole("heading", { name: "秘匿決闘" }),
    ).toBeVisible();
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
    await expect(
      combat
        .locator(".combat-rounds tbody td")
        .first()
        .getByText(/水 · 与ダメージ/),
    ).toBeVisible();
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
      .getByRole("button", { name: /アイテムを強奪/ })
      .first()
      .click();
    await reload();
    await expect(reward).toHaveCount(0);
    await page.getByRole("button", { name: /課題を判定して夜明けへ/ }).click();
    const dawn = page.getByRole("region", { name: "夜明けのまとめ" });
    await expect(dawn).toContainText(/今日の課題：(成功|失敗)/);
    await expect(dawn).toContainText("持ち物の増減（1日全体）");
    await expect(
      dawn.getByRole("region", { name: "名声の増減", exact: true }),
    ).toBeVisible();
    await expect(dawn).toContainText("第1日のまとめ");
    await expect(
      dawn.getByRole("heading", { name: "課題判定・夜明け", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("新しい朝がやってきた。", { exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".phase-message")).toHaveCount(0);
    const saved = () =>
      page.evaluate(() => localStorage.getItem("majoken-save-rules-2.1"));
    await expect(dawn).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("dawn.png"),
      fullPage: true,
    });
    const before = await saved();
    await reload();
    await expect(dawn).toBeVisible();
    expect(await saved()).toBe(before);
    await page.getByRole("button", { name: /次の日へ/ }).click();
    await expect(dawn).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /第 2 日/ })).toBeVisible();
    const after = await saved();
    await reload();
    await expect(dawn).toHaveCount(0);
    expect(await saved()).toBe(after);
  });
}
