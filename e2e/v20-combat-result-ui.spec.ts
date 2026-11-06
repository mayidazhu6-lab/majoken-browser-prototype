import { expect, test } from "@playwright/test";
import { settleScreens } from "./helpers";
for (const width of [1440, 390]) {
  test(`公開決闘の結果を同じ画面で確認し詳細を開閉・再開 ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: /ゲーム開始/ }).click();
    await page.getByRole("checkbox", { name: "開発者モード" }).check();
    await page.getByLabel(/乱数シード/).fill("v20-battle-36");
    await page.getByRole("button", { name: "研究開始", exact: true }).click();
    await settleScreens(page);
    await page
      .getByRole("button", { name: "決闘（1AP）", exact: true })
      .click();
    await page
      .getByRole("button", { name: "公開決闘 1AP", exact: true })
      .click();
    const combat = page.locator(".combat-panel");
    await combat.getByRole("button", { name: "持ち込まずに進む" }).click();
    for (let i = 0; i < 5; i++) {
      const confirm = combat.getByRole("button", { name: "属性と薬を確定" });
      if (!(await confirm.isVisible())) break;
      await combat.getByRole("button", { name: "水", exact: true }).click();
      await confirm.click();
    }
    await expect(
      combat.getByRole("heading", { name: /の勝利|引き分け/ }),
    ).toBeVisible();
    await expect(combat.locator(".duel-hp")).toHaveCount(2);
    await expect(combat.locator(".combat-fp span")).toHaveCount(2);
    const saved = () =>
      page.evaluate(() => localStorage.getItem("majoken-save-rules-2.0.2"));
    const before = await saved();
    const state = JSON.parse(before!).state;
    const c = state.combat;
    for (const id of c.participants) {
      const fp = state.players[id].fp;
      await expect(combat.locator(".combat-fp")).toContainText(
        `${fp - Number(c.winner === id)} → ${fp}`,
      );
    }
    const details = combat.locator(".combat-details");
    await expect(details).not.toHaveAttribute("open", "");
    await expect(details.getByRole("table")).toBeHidden();
    await page.screenshot({
      path: testInfo.outputPath("result.png"),
      fullPage: true,
    });
    await details.getByText("戦闘の詳細を見る", { exact: true }).click();
    await expect(details.getByRole("table")).toBeVisible();
    await expect(details).toContainText("与ダメージ");
    await expect(details).toContainText("残HP");
    await expect(details.locator("tbody tr")).toHaveCount(
      c.elemental.rounds.length,
    );
    await page.screenshot({
      path: testInfo.outputPath("details.png"),
      fullPage: true,
    });
    expect(await saved()).toBe(before);
    await page.reload();
    await page.getByRole("button", { name: "続きから" }).click();
    await expect(details.getByRole("table")).toBeHidden();
    expect(await saved()).toBe(before);
    await combat.getByRole("button", { name: "確認した", exact: true }).click();
    await expect(combat).toHaveCount(0);
    await expect(page.locator(".action-result")).toHaveCount(0);
    const after = await saved();
    await page.reload();
    await page.getByRole("button", { name: "続きから" }).click();
    await expect(page.locator(".action-result")).toHaveCount(0);
    expect(await saved()).toBe(after);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
