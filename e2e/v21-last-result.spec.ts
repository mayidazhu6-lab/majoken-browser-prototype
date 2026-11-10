import { expect, test } from "@playwright/test";
import { day8Fixture, day8Setup } from "../tests/fixtures/v21Day8";
import { collapseFixture, completedFixture } from "../tests/fixtures/endings";
import { createGame } from "../src/domain/reducer";
import { serialize } from "../src/domain/persistence";
import {
  captureResult,
  encodeResult,
  LAST_RESULT_KEY,
} from "../src/records/lastResult";
const key = "majoken-save-rules-2.1";
for (const width of [1440, 390])
  test(`結果保存・閲覧・進行中保存との分離 ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 960 });
    const { before, after } = day8Fixture();
    await page.addInitScript(
      ({ key, raw }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, raw);
      },
      { key, raw: serialize(before) },
    );
    await page.goto("/");
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    await page
      .getByRole("button", { name: /課題を判定して第8日のまとめへ/ })
      .click();
    await expect(page.locator(".day8-summary")).toBeVisible();
    const record = await page.evaluate(
      (k) => localStorage.getItem(k),
      LAST_RESULT_KEY,
    );
    expect(record).toBe(encodeResult(captureResult(after)));
    await page.getByRole("button", { name: "最終結果へ", exact: true }).click();
    await page
      .getByRole("button", { name: "新しい研究を始める", exact: true })
      .click();
    // Simulate a different in-progress save without loading it into the archive viewer.
    const progress = serialize(
      createGame({ ...day8Setup, seed: "next-research" }, "browser-2.1"),
    );
    await page.evaluate(
      ({ key, progress }) => localStorage.setItem(key, progress),
      { key, progress },
    );
    await page.getByRole("button", { name: "記録", exact: true }).click();
    await page.getByRole("button", { name: "前回の結果", exact: true }).click();
    await expect(page.locator(".final-results")).toBeVisible();
    await expect(
      page.locator(".alert").filter({ hasText: "保存データを再開しました" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "新しい研究を始める", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "続きから", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "HOを公開", exact: true }).click();
    await expect(page.locator(".ho-details")).toBeVisible();
    await page
      .getByRole("button", { name: "第8日のまとめを見る", exact: true })
      .click();
    await expect(page.locator(".day8-summary")).toBeVisible();
    await page.getByRole("button", { name: "最終結果へ", exact: true }).click();
    expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(
      progress,
    );
    expect(
      await page.evaluate((k) => localStorage.getItem(k), LAST_RESULT_KEY),
    ).toBe(record);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`archive-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "タイトルへ戻る", exact: true })
      .click();
    await page.reload();
    await page.getByRole("button", { name: "記録", exact: true }).click();
    await page.getByRole("button", { name: "前回の結果", exact: true }).click();
    await expect(page.locator(".final-results")).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(
      progress,
    );
  });
test("結果保存失敗は旧結果を保持し、結果を表示したまま同じ記録だけを再保存する", async ({
  page,
}) => {
  const { before, after } = day8Fixture();
  const prior = encodeResult(captureResult(collapseFixture()));
  await page.addInitScript(
    ({ key, raw, last, prior }) => {
      localStorage.setItem(key, raw);
      localStorage.setItem(last, prior);
      const set = Storage.prototype.setItem;
      let fail = true;
      Storage.prototype.setItem = function (k, v) {
        if (k === last && fail) {
          fail = false;
          throw Error("quota");
        }
        return set.call(this, k, v);
      };
    },
    { key, raw: serialize(before), last: LAST_RESULT_KEY, prior },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  await page
    .getByRole("button", { name: /課題を判定して第8日のまとめへ/ })
    .click();
  await expect(page.locator(".day8-summary")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "終了結果の保存を再試行", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate((k) => localStorage.getItem(k), LAST_RESULT_KEY),
  ).toBe(prior);
  const game = await page.evaluate((k) => localStorage.getItem(k), key);
  await page
    .getByRole("button", { name: "終了結果の保存を再試行", exact: true })
    .click();
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(game);
  expect(
    await page.evaluate((k) => localStorage.getItem(k), LAST_RESULT_KEY),
  ).toBe(encodeResult(captureResult(after)));
});
for (const corrupt of [false, true])
  test(`記録なし・破損の安全な案内 ${corrupt}`, async ({ page }) => {
    if (corrupt)
      await page.addInitScript(
        (k) => localStorage.setItem(k, "broken"),
        LAST_RESULT_KEY,
      );
    await page.goto("/");
    await page.getByRole("button", { name: "記録", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "前回の結果", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("region", { name: "研究の記録" }),
    ).toContainText(corrupt ? "読み込めません" : "まだ研究の記録はありません");
    if (corrupt)
      expect(
        await page.evaluate((k) => localStorage.getItem(k), LAST_RESULT_KEY),
      ).toBe("broken");
  });

for (const width of [1440, 390])
  test(`崩壊記録の閲覧専用表示 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const raw = encodeResult(captureResult(collapseFixture()));
    await page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), {
      key: LAST_RESULT_KEY,
      raw,
    });
    await page.goto("/");
    await page.getByRole("button", { name: "記録", exact: true }).click();
    await page.getByRole("button", { name: "前回の結果", exact: true }).click();
    await expect(
      page.locator("[data-result-player]").filter({ hasText: "研究所崩壊" }),
    ).toHaveCount(4);
    await expect(
      page.getByRole("button", { name: "第8日のまとめを見る", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "HOを公開", exact: true }).click();
    await expect(page.locator(".ho-details")).toContainText("未判定・報酬なし");
    await page
      .getByRole("button", { name: "タイトルへ戻る", exact: true })
      .click();
    expect(
      await page.evaluate((k) => localStorage.getItem(k), LAST_RESULT_KEY),
    ).toBe(raw);
    expect(
      await page.evaluate(
        (k) => localStorage.getItem(k),
        "majoken-save-rules-2.1",
      ),
    ).toBeNull();
  });

test("旧版の独立記録も保存されたルールと結果で閲覧する", async ({ page }) => {
  const raw = encodeResult(captureResult(completedFixture("browser-2.0.4")));
  await page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), {
    key: LAST_RESULT_KEY,
    raw,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "記録", exact: true }).click();
  await page.getByRole("button", { name: "前回の結果", exact: true }).click();
  await expect(page.locator("footer")).toContainText("browser-2.0.4");
  await page
    .getByRole("button", { name: "第8日のまとめを見る", exact: true })
    .click();
  await expect(
    page.locator("[data-fp-player]").filter({ hasText: "FP内訳：記録なし" }),
  ).toHaveCount(4);
  expect(
    await page.evaluate((k) => localStorage.getItem(k), LAST_RESULT_KEY),
  ).toBe(raw);
});
