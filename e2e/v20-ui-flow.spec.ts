import { expect, test } from "@playwright/test";
import { settleScreens } from "./helpers";

for (const width of [1440, 390]) {
  test(`公開行動の表示とボタン間隔 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: /ゲーム開始/ }).click();
    await page.getByRole("button", { name: "研究開始", exact: true }).click();
    await settleScreens(page);
    await page
      .getByRole("button", { name: "納品（0AP）", exact: true })
      .click();
    const reserve = page.getByRole("button", {
      name: "仮納品する（0AP）",
      exact: true,
    });
    await expect(reserve).toBeDisabled();
    await expect(
      page.getByText("納品する品物・能力を選択してください。", { exact: true }),
    ).toHaveCount(0);
    expect(
      await reserve.evaluate((el) => el.nextSibling?.textContent?.trim()),
    ).not.toBe(">");
    await page.screenshot({
      path: testInfo.outputPath("delivery.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "キャンセルして戻る" }).click();
    await page
      .getByRole("button", { name: "購買部（1AP）", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "購買部", exact: true }),
    ).toHaveCount(1);
    await expect(page.getByText(/指定素材1個/)).toBeVisible();
    await page.getByRole("button", { name: "キャンセルして戻る" }).click();
    await page
      .getByRole("button", { name: "決闘（1AP）", exact: true })
      .click();
    const a = await page
      .getByRole("button", { name: "公開決闘 1AP", exact: true })
      .boundingBox();
    const b = await page
      .getByRole("button", { name: "イベント模擬戦 0AP", exact: true })
      .boundingBox();
    expect(a && b).toBeTruthy();
    expect(
      Math.max(b!.x - a!.x - a!.width, b!.y - a!.y - a!.height),
    ).toBeGreaterThanOrEqual(15);
    expect(a!.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("duel.png"),
      fullPage: true,
    });
  });
}
