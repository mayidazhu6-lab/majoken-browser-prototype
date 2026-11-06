import { expect, test } from "@playwright/test";
import { settleScreens } from "./helpers";

for (const width of [1440, 390]) {
  test(`公開行動の表示とボタン間隔 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    const start = page.getByRole("button", { name: /ゲーム開始/ });
    const rules = page.locator(".intro-rules button");
    const aTitle = (await start.boundingBox())!;
    const bTitle = (await rules.boundingBox())!;
    expect(aTitle.width).toBeCloseTo(bTitle.width);
    expect(aTitle.width).toBeLessThan(width - 100);
    expect(aTitle.x).toBeCloseTo(bTitle.x);
    expect(await start.evaluate((el) => getComputedStyle(el).textAlign)).toBe(
      "center",
    );
    expect(
      await page
        .locator(".intro-notes")
        .evaluate((el) => getComputedStyle(el).borderTopWidth),
    ).toBe("0px");
    await page.screenshot({
      path: testInfo.outputPath("title.png"),
      fullPage: true,
    });
    await start.click();
    await page.getByRole("checkbox", { name: "開発者モード" }).check();
    await page.getByLabel(/乱数シード/).fill("quantity-0");
    await page.getByRole("button", { name: "研究開始", exact: true }).click();
    await settleScreens(page);
    await page.getByRole("checkbox", { name: "開発者モード" }).uncheck();
    await page
      .getByRole("button", { name: "納品（0AP）", exact: true })
      .click();
    const reserve = page.getByRole("button", {
      name: "仮納品する（0AP）",
      exact: true,
    });
    await expect(reserve).toBeDisabled();
    const statSpinner = page.locator(".stat-inputs .quantity-spinner").first();
    const statInput = statSpinner.getByRole("spinbutton");
    const statMax = Number(await statInput.getAttribute("max"));
    await statSpinner.getByRole("button", { name: /増やす/ }).click();
    await expect(statInput).toHaveValue("1");
    await expect(reserve).toBeEnabled();
    await statInput.fill(String(statMax));
    await statSpinner.getByRole("button", { name: /増やす/ }).click();
    await expect(statInput).toHaveValue(String(statMax));
    await statInput.fill("0");
    await statSpinner.getByRole("button", { name: /減らす/ }).click();
    await expect(statInput).toHaveValue("0");

    await expect(
      page.getByText("納品する品物・能力を選択してください。", { exact: true }),
    ).toHaveCount(0);
    expect(
      await reserve.evaluate((el) => el.nextSibling?.textContent?.trim()),
    ).not.toBe(">");
    const withdraw = page.getByRole("button", {
      name: "自分の予約をすべて撤回（0AP）",
      exact: true,
    });
    const r = (await reserve.boundingBox())!,
      w = (await withdraw.boundingBox())!;
    expect(
      Math.max(w.x - r.x - r.width, w.y - r.y - r.height),
    ).toBeGreaterThanOrEqual(15);
    await expect(page.getByText(/このイベントに納品できる未予約/)).toHaveCount(
      0,
    );
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
    const saved = await page.evaluate(() =>
      localStorage.getItem("majoken-save-rules-2.0.3"),
    );
    const spinner = page.locator(".grouped-items .quantity-spinner").first();
    const input = spinner.getByRole("spinbutton");
    const max = Number(await input.getAttribute("max"));
    await input.fill("0");
    await spinner.getByRole("button", { name: /増やす/ }).click();
    await expect(input).toHaveValue(String(Math.min(1, max)));
    await spinner.getByRole("button", { name: /減らす/ }).click();
    await expect(input).toHaveValue("0");
    await spinner.getByRole("button", { name: /減らす/ }).click();
    await expect(input).toHaveValue("0");
    await input.fill(String(max));
    await spinner.getByRole("button", { name: /増やす/ }).click();
    await expect(input).toHaveValue(String(max));
    await input.focus();
    await input.press("ArrowDown");
    await expect(input).toHaveValue(String(max - 1));
    await input.press("ArrowUp");
    await expect(input).toHaveValue(String(max));
    expect(
      await page.evaluate(() =>
        localStorage.getItem("majoken-save-rules-2.0.3"),
      ),
    ).toBe(saved);
    await page.screenshot({
      path: testInfo.outputPath("quantity.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "キャンセルして戻る" }).click();
    await page
      .getByRole("button", { name: "魔女間取引（0AP）", exact: true })
      .click();
    await page.getByText("提供と要求の個数を入力", { exact: true }).click();
    const request = page.getByRole("spinbutton", {
      name: "黒曜石 要求数",
      exact: true,
    });
    await page
      .getByRole("button", { name: "黒曜石 要求数を増やす", exact: true })
      .click();
    await expect(request).toHaveValue("1");
    await page
      .getByRole("button", { name: "黒曜石 要求数を減らす", exact: true })
      .click();
    await expect(request).toHaveValue("0");
    expect(
      await page.evaluate(() =>
        localStorage.getItem("majoken-save-rules-2.0.3"),
      ),
    ).toBe(saved);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("trade.png"),
      fullPage: true,
    });
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
