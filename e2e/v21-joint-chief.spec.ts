import { expect, test } from "@playwright/test";
import { completedFixture, collapseFixture } from "../tests/fixtures/endings";
import {
  captureResult,
  encodeResult,
  LAST_RESULT_KEY,
} from "../src/records/lastResult";
import { serialize } from "../src/domain/persistence";

// Display-only cases; never import fabricated states as playable game saves.
function displayState(count: number, version = "browser-2.1") {
  const s = completedFixture(version);
  delete s.day8Fp;
  const chiefs = s.players.slice(0, count).map((p) => p.id);
  const graduates = count
    ? s.players.slice(0, Math.min(4, count + 1)).map((p) => p.id)
    : [];
  for (const p of s.players) {
    p.fp = chiefs.includes(p.id) ? 7 : 6;
    p.dailyHistory.forEach((h, i) => (h.achieved = i < 2));
    p.longGoal.achieved = graduates.includes(p.id);
  }
  s.result = {
    reason: "completed",
    chiefs,
    graduates,
    ranking: s.players.map((p) => ({
      player: p.id,
      fp: p.fp,
      daily: 2,
      graduated: graduates.includes(p.id),
      rank: chiefs.includes(p.id)
        ? 1
        : graduates.includes(p.id)
          ? count + 1
          : null,
    })),
  };
  return s;
}
for (const width of [1440, 390]) {
  for (const count of [0, 1, 2, 3, 4]) {
    test(`共同首席の確定表示と凍結記録 ${count}人 ${width}px`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 960 });
      const s = displayState(count),
        before = serialize(s);
      const raw = encodeResult(captureResult(s));
      await page.goto("/");
      await page.evaluate(async (state) => {
        const componentPath = "/src/components/EndingScreens.vue",
          vuePath = "/node_modules/.vite/deps/vue.js";
        const { default: Ending } = await import(componentPath);
        const { createApp, h, ref } = await import(vuePath);
        const target = document.createElement("div");
        document.querySelector("#app")!.replaceChildren(target);
        createApp({
          setup() {
            const view = ref("results");
            return () =>
              h(Ending, {
                state,
                view: view.value,
                onNavigate: (v: string) => (view.value = v),
              });
          },
        }).mount(target);
      }, JSON.parse(before).state);
      const assertOutcomes = async () => {
        for (const row of s.result!.ranking) {
          const outcome =
            row.rank === 1
              ? count > 1
                ? "共同首席"
                : "首席"
              : row.graduated
                ? "卒業"
                : "落第";
          await expect(
            page.locator(`[data-result-player="${row.player}"] .outcome`),
          ).toHaveText(outcome);
          await expect(
            page.locator(`[data-result-player="${row.player}"]`),
          ).toContainText(`${row.fp}FP`);
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      };
      const toggle = async () => {
        await assertOutcomes();
        await page
          .getByRole("button", { name: "HOを公開", exact: true })
          .click();
        await assertOutcomes();
        await page
          .getByRole("button", { name: "HOを閉じる", exact: true })
          .click();
        await page
          .getByRole("button", { name: "第8日のまとめを見る", exact: true })
          .click();
        await expect(page.locator(".day8-summary")).not.toContainText(
          "共同首席",
        );
        await page
          .getByRole("button", { name: "最終結果へ", exact: true })
          .click();
        await assertOutcomes();
      };
      await toggle();
      if (count === 3)
        await page.screenshot({
          path: info.outputPath(`joint-${width}.png`),
          fullPage: true,
        });
      expect(serialize(s)).toBe(before);
      await page.evaluate(
        ({ key, raw }) => {
          localStorage.clear();
          localStorage.setItem(key, raw);
          localStorage.setItem("majoken-save-rules-2.1", "untouched-progress");
        },
        { key: LAST_RESULT_KEY, raw },
      );
      await page.reload();
      await page.getByRole("button", { name: "記録", exact: true }).click();
      await page
        .getByRole("button", { name: "前回の結果", exact: true })
        .click();
      await toggle();
      await page.reload();
      await page.getByRole("button", { name: "記録", exact: true }).click();
      await page
        .getByRole("button", { name: "前回の結果", exact: true })
        .click();
      await assertOutcomes();
      expect(
        await page.evaluate((k) => localStorage.getItem(k), LAST_RESULT_KEY),
      ).toBe(raw);
      expect(
        await page.evaluate(() =>
          localStorage.getItem("majoken-save-rules-2.1"),
        ),
      ).toBe("untouched-progress");
    });
  }
  test(`旧版共同首位と崩壊記録を変更しない ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    for (const s of [displayState(3, "browser-2.0.4"), collapseFixture()]) {
      const raw = encodeResult(captureResult(s));
      await page.goto("/");
      await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
        key: LAST_RESULT_KEY,
        raw,
      });
      await page.reload();
      await page.getByRole("button", { name: "記録", exact: true }).click();
      await page
        .getByRole("button", { name: "前回の結果", exact: true })
        .click();
      await expect(page.locator(".final-results")).not.toContainText(
        "共同首席",
      );
      await expect(page.locator(".outcome")).toHaveText(
        s.result!.reason === "collapse"
          ? Array(4).fill("研究所崩壊")
          : ["首席", "首席", "首席", "卒業"],
      );
      expect(
        await page.evaluate((k) => localStorage.getItem(k), LAST_RESULT_KEY),
      ).toBe(raw);
    }
  });
}
