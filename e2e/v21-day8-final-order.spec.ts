import { day8FpBreakdown } from "../src/domain/day8Fp";
import { expect, test } from "@playwright/test";
import { day8Fixture } from "../tests/fixtures/v21Day8";
import { deserialize, serialize } from "../src/domain/persistence";
const key = "majoken-save-rules-2.1";
for (const width of [1440, 390])
  test(`第8日判定・結果再開と保存再試行 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { before, after } = day8Fixture();
    await page.addInitScript(
      ({ key, raw }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, raw);
      },
      { key, raw: serialize(before) },
    );
    await page.goto("/");
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    // Only this isolated browser context rejects its first final-state write.
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      let fail = true;
      Storage.prototype.setItem = function (k, v) {
        if (
          fail &&
          k === "majoken-save-rules-2.1" &&
          JSON.parse(v).state.phase === "ended"
        ) {
          fail = false;
          throw Error("test quota");
        }
        return original.call(this, k, v);
      };
    });
    await page.getByRole("button", { name: /課題を判定して夜明けへ/ }).click();
    const failure = page.getByRole("dialog", {
      name: "保存に失敗しました",
      exact: true,
    });
    await expect(failure).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      serialize(before),
    );
    await failure
      .getByRole("button", { name: "保存を再試行", exact: true })
      .click();
    await expect(failure).toHaveCount(0);
    const saved = await page.evaluate((key) => localStorage.getItem(key), key);
    const confirmed = deserialize(saved!);
    expect(confirmed).toEqual(after);
    const breakdown = day8FpBreakdown(confirmed)!;
    expect(breakdown).toEqual(day8FpBreakdown(after));
    expect(breakdown.players).toHaveLength(4);
    for (const p of breakdown.players)
      expect(p.end - p.start).toBe(p.entries.reduce((n, e) => n + e.amount, 0));
    for (let i = 0; i < 2; i++) {
      await page.reload();
      await page.getByRole("button", { name: "続きから", exact: true }).click();
      await expect(
        page.locator("p.eyebrow").filter({ hasText: "研究終了" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "遊び方・ルール説明", exact: true })
        .click();
      const guide = page.getByRole("dialog", {
        name: "遊び方・ルール説明",
        exact: true,
      });
      await expect(guide).toContainText("日次HO報酬を全員に反映した後");
      await guide.getByRole("button", { name: "閉じる", exact: true }).click();
      expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
        saved,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  });
