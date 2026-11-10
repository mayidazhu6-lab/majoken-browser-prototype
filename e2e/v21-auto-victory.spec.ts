import { expect, test } from "@playwright/test";
import { autoVictoryFixture } from "../tests/fixtures/v21AutoVictory";
import { deserialize, serialize } from "../src/domain/persistence";
import { duelHistory } from "../src/domain/duelHistory";
import { graduationProgress } from "../src/ui/graduationProgress";
const key = "majoken-save-rules-2.1";

for (const width of [1440, 390])
  for (const role of ["attacker", "resting", "third"] as const) {
    test(`自動勝利の通知・HO・再開・秘匿性 ${role} ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const { after } = autoVictoryFixture(role);
      const raw = serialize(after);
      expect(deserialize(raw)).toEqual(after);
      await page.addInitScript(
        ({ key, raw }) => {
          if (!localStorage.getItem(key)) localStorage.setItem(key, raw);
        },
        { key, raw },
      );
      await page.goto("/");
      const own = after.logs.filter(
        (l) =>
          l.type === "automaticBattle" && l.day === after.day && l.actor === 0,
      );
      const foreign = after.logs.filter(
        (l) =>
          l.type === "automaticBattle" && l.day === after.day && l.actor !== 0,
      );
      const panel = page.getByRole("region", {
        name: "自動決着の結果",
        exact: true,
      });
      for (let reload = 0; reload < 2; reload++) {
        await page
          .getByRole("button", { name: "続きから", exact: true })
          .click();
        if (role === "third") {
          await expect(panel).toHaveCount(0);
        } else {
          await expect(panel).toBeVisible();
          await expect(panel.locator("li")).toHaveCount(own.length);
          for (const notice of own)
            await expect(panel).toContainText(notice.text);
        }
        await page.getByRole("button", { name: "課題", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "課題", exact: true });
        await dialog
          .getByRole("button", { name: "卒業課題", exact: true })
          .click();
        for (const line of graduationProgress(after))
          await expect(dialog).toContainText(line);
        if (role === "attacker")
          await expect(dialog).toContainText("休息者への襲撃自動勝利");
        await dialog
          .getByRole("button", { name: "閉じる", exact: true })
          .click();
        await page.getByText("研究日誌を開く", { exact: true }).click();
        const journal = page.locator(".journal");
        for (const notice of own)
          await expect(
            journal.locator(`[data-log-seq="${notice.seq}"]`),
          ).toContainText(notice.text);
        for (const notice of foreign)
          await expect(
            journal.locator(`[data-log-seq="${notice.seq}"]`),
          ).toHaveCount(0);
        expect(
          await page.evaluate((key) => localStorage.getItem(key), key),
        ).toBe(raw);
        if (reload === 0) await page.reload();
      }
      await page
        .getByRole("button", { name: /課題を判定して夜明けへ/ })
        .click();
      const summary = page.locator(".dawn-summary");
      await expect(summary).toBeVisible();
      for (const notice of foreign) {
        // Different attackers can generate identical prose. Compare counts against
        // the player's own records rather than treating that prose as identity.
        await expect(
          summary
            .getByRole("region", { name: "夜間行動の結果", exact: true })
            .locator("li")
            .filter({ hasText: notice.text }),
        ).toHaveCount(own.filter((l) => l.text === notice.text).length);
      }
      const judged = await page.evaluate(
        (key) => localStorage.getItem(key),
        key,
      );
      const state = deserialize(judged!);
      expect(duelHistory(state)).toEqual(duelHistory(after));
      const button = page.getByRole("button", { name: "課題", exact: true });
      await button.click();
      await page
        .getByRole("dialog", { name: "課題", exact: true })
        .getByRole("button", { name: "閉じる", exact: true })
        .click();
      expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
        judged,
      );
      await page.reload();
      await page.getByRole("button", { name: "続きから", exact: true }).click();
      await expect(summary).toBeVisible();
      expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
        judged,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
