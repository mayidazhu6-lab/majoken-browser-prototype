import { expect, test, type Page } from "@playwright/test";
import { day8Fixture } from "../tests/fixtures/v21Day8";
import { completedFixture, collapseFixture } from "../tests/fixtures/endings";
import { serialize, deserialize } from "../src/domain/persistence";
import { dispatch } from "../src/domain/reducer";
import {
  endingRows,
  endingGoal,
  endingSummary,
  fpReason,
} from "../src/ui/ending";
import type { GameState } from "../src/domain/types";
const key = "majoken-save-rules-2.1";
async function load(page: Page, s: GameState, slot = key) {
  const raw = serialize(s);
  expect(deserialize(raw)).toEqual(s);
  await page.addInitScript(
    ({ slot, raw }) => {
      if (!localStorage.getItem(slot)) localStorage.setItem(slot, raw);
    },
    { slot, raw },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  return raw;
}
async function saved(page: Page, slot = key) {
  return page.evaluate((k) => localStorage.getItem(k), slot);
}
async function fit(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function assertRows(page: Page, s: GameState) {
  const cards = page.locator("[data-result-player]");
  const rows = endingRows(s);
  await expect(cards).toHaveCount(4);
  expect(
    await cards.evaluateAll((els) =>
      els.map((e) => Number(e.getAttribute("data-result-player"))),
    ),
  ).toEqual(rows.map((r) => r.player));
  for (const row of rows) {
    const card = page.locator(`[data-result-player="${row.player}"]`);
    await expect(card).toContainText(row.name);
    await expect(card).toContainText(row.outcome);
    await expect(card).toContainText(row.rankText);
    await expect(card).toContainText(`${row.fp}FP`);
    await expect(card).toContainText(`長期HO：${row.status}`);
  }
}
for (const width of [1440, 390])
  test(`第8日まとめの秘匿・一斉結果・HO開閉・往復と再開 ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 960 });
    const { before, after } = day8Fixture();
    await load(page, before);
    await page
      .getByRole("button", { name: /課題を判定して第8日のまとめへ/ })
      .click();
    const raw = serialize(after);
    expect(await saved(page)).toBe(raw);
    const summary = page.locator(".day8-summary");
    await expect(summary).toBeVisible();
    await expect(page.locator(".final-results")).toHaveCount(0);
    await expect(page.locator(".game-grid")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "次の日へ", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".app-shell")).not.toContainText(
      /長期HO|卒業課題|首席|落第|同率1位/,
    );
    const expected = endingSummary(after);
    for (const p of expected.players) {
      const card = summary.locator(`[data-fp-player="${p.player}"]`);
      await expect(card).toContainText(p.name);
      await expect(card).toContainText(`現在FP ${p.fp}`);
      for (const e of p.breakdown?.entries ?? []) {
        await expect(card).toContainText(fpReason(after, e));
        await expect(card).toContainText(
          `${e.amount > 0 ? "＋" : "－"}${Math.abs(e.amount)}FP`,
        );
      }
    }
    for (const log of after.logs.filter(
      (l) =>
        l.day === 8 && Array.isArray(l.audience) && !l.audience.includes(0),
    ))
      await expect(summary.locator(`[data-log-seq="${log.seq}"]`)).toHaveCount(
        0,
      );
    await fit(page);
    await page.screenshot({
      path: info.outputPath(`summary-${width}.png`),
      fullPage: true,
    });
    await page.reload();
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    await expect(summary).toBeVisible();
    await expect(page.locator(".final-results")).toHaveCount(0);
    for (let i = 0; i < 2; i++) {
      await page
        .getByRole("button", { name: "最終結果へ", exact: true })
        .click();
      await assertRows(page, after);
      await expect(page.locator(".ho-details")).toHaveCount(0);
      await page.getByRole("button", { name: "HOを公開", exact: true }).click();
      const details = page.getByRole("region", {
        name: "全員のHO詳細",
        exact: true,
      });
      await expect(details).toBeVisible();
      for (const p of after.players)
        await expect(details).toContainText(
          endingGoal(after, p.longGoal, true).name,
        );
      await fit(page);
      if (i === 0 && width === 390) {
        await page
          .getByRole("heading", { name: "最終結果", exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: info.outputPath("results-phone-viewport.png"),
        });
      }
      if (i === 0)
        await page.screenshot({
          path: info.outputPath(`results-ho-${width}.png`),
          fullPage: true,
        });
      await page
        .getByRole("button", { name: "HOを閉じる", exact: true })
        .click();
      await expect(details).toHaveCount(0);
      await page
        .getByRole("button", { name: "第8日のまとめを見る", exact: true })
        .click();
      await expect(summary).toBeVisible();
      await expect(page.locator(".app-shell")).not.toContainText(
        /長期HO|卒業課題|首席|落第|同率1位/,
      );
      expect(await saved(page)).toBe(raw);
    }
    await page.getByRole("button", { name: "最終結果へ", exact: true }).click();
    await page.getByRole("button", { name: "HOを公開", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    await assertRows(page, after);
    await expect(page.locator(".ho-details")).toHaveCount(0);
    expect(await saved(page)).toBe(raw);
    await fit(page);
  });

for (const width of [1440, 390])
  test(`崩壊は失敗確認後に直接結果、HO未判定・席順 ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    const s = collapseFixture();
    const raw = await load(page, s);
    const dialog = page.getByRole("dialog", {
      name: "共通イベントの結果",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(page.locator(".final-results")).toHaveCount(0);
    await expect(page.locator(".day8-summary")).toHaveCount(0);
    expect(await saved(page)).toBe(raw);
    await dialog.getByRole("button", { name: "確認した", exact: true }).click();
    const after = dispatch(s, { type: "eventAck", player: 0 });
    await assertRows(page, after);
    await expect(
      page.getByRole("button", { name: "第8日のまとめを見る", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "HOを公開", exact: true }).click();
    await expect(page.locator(".ho-details")).toContainText("未判定・報酬なし");
    expect(await saved(page)).toBe(serialize(after));
    await fit(page);
  });

for (const version of [
  "browser-2.0",
  "browser-2.0.1",
  "browser-2.0.2",
  "browser-2.0.3",
  "browser-2.0.4",
])
  test(`旧版の確定結果を共通UIで閲覧・FP記録なし ${version}`, async ({
    page,
  }) => {
    const s = completedFixture(version);
    const slot =
      version === "browser-2.0"
        ? "majoken-save-rules-2.0-final"
        : `majoken-save-rules-${version.replace("browser-", "")}`;
    const raw = await load(page, s, slot);
    await expect(page.locator(".day8-summary")).toBeVisible();
    await expect(
      page.locator("[data-fp-player]").filter({ hasText: "FP内訳：記録なし" }),
    ).toHaveCount(4);
    await page.getByRole("button", { name: "最終結果へ", exact: true }).click();
    await assertRows(page, s);
    await page.getByRole("button", { name: "HOを公開", exact: true }).click();
    await expect(page.locator(".ho-details")).toBeVisible();
    expect(await saved(page, slot)).toBe(raw);
    await page
      .getByRole("button", { name: "第8日のまとめを見る", exact: true })
      .click();
    expect(await saved(page, slot)).toBe(raw);
  });

// UI-only synthetic fixtures: mount the display component directly, never import a fabricated save.
for (const width of [1440, 390])
  for (const mode of ["ties", "failures"])
    test(`同率・全員落第・長文と増減なし ${mode} ${width}px`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 960 });
      const s = completedFixture();
      for (const p of s.players)
        p.name = `${p.id}番の魔女・長い名前の折り返し確認`;
      s.result!.chiefs = mode === "ties" ? [0, 1] : [];
      s.result!.graduates = mode === "ties" ? [0, 1, 2] : [];
      s.result!.ranking = s.players.map((p) => ({
        player: p.id,
        rank: mode === "failures" ? null : p.id < 2 ? 1 : p.id === 2 ? 3 : null,
        fp: 7,
        daily: 3,
        graduated: mode === "ties" && p.id < 3,
      }));
      s.day8Fp = {
        day: 8,
        start: s.players.map((p) => ({ player: p.id, fp: 7 })),
        entries: [],
        final: s.players.map((p) => ({ player: p.id, fp: 7 })),
      };
      await page.goto("/");
      await page.evaluate(
        async (state) => {
          const componentPath = "/src/components/EndingScreens.vue";
          const vuePath = "/node_modules/.vite/deps/vue.js";
          const { default: Ending } = await import(componentPath);
          const { createApp, h, ref } = await import(vuePath);
          document.querySelector("#app")!.replaceChildren();
          const target = document.createElement("div");
          target.className = "app-shell";
          document.querySelector("#app")!.append(target);
          createApp({
            setup() {
              const view = ref("results");
              return () =>
                h(Ending, {
                  state,
                  view: view.value,
                  onNavigate: (v: string) => (view.value = v),
                  onRestart: () => {},
                });
            },
          }).mount(target);
        },
        JSON.parse(JSON.stringify(s)),
      );
      await assertRows(page, s);
      await expect(
        page.locator("[data-result-player]").filter({ hasText: "同率1位" }),
      ).toHaveCount(mode === "ties" ? 2 : 0);
      await page.getByRole("button", { name: "HOを公開", exact: true }).click();
      await fit(page);
      await page.screenshot({
        path: info.outputPath(`${mode}-long-${width}.png`),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "第8日のまとめを見る", exact: true })
        .click();
      await expect(
        page.locator("[data-fp-player]").filter({ hasText: "増減なし" }),
      ).toHaveCount(4);
      await expect(page.locator(".day8-summary")).not.toContainText(
        "FP内訳：記録なし",
      );
    });
