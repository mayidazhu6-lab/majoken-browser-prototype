import { expect, test, type Page } from "@playwright/test";
import { createGame, currentPlayer } from "../src/domain/reducer";
import { serialize } from "../src/domain/persistence";
import type { GameState } from "../src/domain/types";
import { settleScreens } from "./helpers";

function eventGame(id: number) {
  for (let n = 0; n < 1500; n++) {
    const s = createGame(
      {
        name: "アリア",
        seed: `stage1-${n}`,
        magic: "barrier",
        stats: { attack: 3, defense: 3, insight: 3 },
      },
      "browser-2.0.4",
    );
    if (s.event.id === id && currentPlayer(s) === 0) return s;
  }
  throw Error(`No seed for event ${id}`);
}
async function load(page: Page, state: GameState) {
  await page.addInitScript((json) => {
    if (!localStorage.getItem("majoken-save-rules-2.0.4"))
      localStorage.setItem("majoken-save-rules-2.0.4", json);
  }, serialize(state));
  await page.goto("/");
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  await settleScreens(page);
}
const saved = (page: Page) =>
  page.evaluate(() => localStorage.getItem("majoken-save-rules-2.0.4"));
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

for (const width of [1440, 390]) {
  test(`stage1 AP, shortcuts, sticky header and resume ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await load(page, eventGame(5));
    const hud = page.getByRole("region", { name: "現在の時間帯と行動点" });
    await expect(hud).toContainText("午前");
    await expect(hud).toContainText("あなたの手番");
    await expect(hud).toContainText("残りAP 2 / 2");
    await expect(hud.locator(".ap-tokens i:not(.spent)")).toHaveCount(2);
    const health = page.getByRole("region", { name: "研究所の残り耐久" });
    await expect(health.getByRole("meter")).toHaveAttribute("value", "3");
    const overview = page.locator(".event-preview");
    await expect(overview).toContainText("不足6個");
    await expect(overview).toContainText("月光草 0 / 1個");
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`home-${width}.png`),
      fullPage: false,
    });
    const before = await saved(page);
    await overview
      .getByRole("button", { name: "納品へ（0AP）", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "今、何をする？", exact: true }),
    ).toBeFocused();
    await expect(
      page.locator(".actions-panel .selection-summary"),
    ).toContainText("必要AP 0");
    expect(await saved(page)).toBe(before);
    await page.getByRole("button", { name: "キャンセルして戻る" }).click();
    await page
      .getByRole("button", { name: "採集（1AP）", exact: true })
      .click();
    expect(await saved(page)).toBe(before);
    await page.getByRole("button", { name: "採集 1AP", exact: true }).click();
    await settleScreens(page);
    await expect(hud).toContainText("残りAP 1 / 2");
    await expect(hud).toContainText("この時間帯は行動済み");
    await expect(hud).toContainText("午後に持ち越します");
    await expect(hud.locator(".ap-tokens i.spent")).toHaveCount(1);
    await expect(
      overview.getByRole("button", { name: "納品へ（0AP）" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "研究（1AP） 詳細のみ" }).click();
    for (const button of await page
      .getByRole("button", { name: "研究 1AP", exact: true })
      .all())
      await expect(button).toBeDisabled();
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect
      .poll(async () => Math.round((await hud.boundingBox())!.y))
      .toBe(0);
    expect(await page.evaluate(() => visualViewport?.scale)).toBe(1);
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`scrolled-${width}.png`),
      fullPage: false,
    });
    const used = await saved(page);
    await page.reload();
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    await settleScreens(page);
    expect(await saved(page)).toBe(used);
    await expect(hud).toContainText("この時間帯は行動済み");
    await page.getByRole("button", { name: /手番終了 \/ パス/ }).click();
    await settleScreens(page);
    await expect(hud).toContainText("午後");
    await expect(hud).toContainText("あなたの手番");
  });
  test(`stage1 mock shortcut only preselects ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await load(page, eventGame(10));
    const before = await saved(page);
    await page
      .locator(".event-preview")
      .getByRole("button", { name: "模擬戦へ（0AP）" })
      .click();
    const panel = page.locator(".actions-panel");
    await expect(panel.locator(".selection-summary")).toContainText(
      "イベント模擬戦 · 必要AP 0",
    );
    await expect(panel.locator(".event-mock-notice")).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "イベント模擬戦 0AP", exact: true }),
    ).toHaveClass(/primary/);
    expect(await saved(page)).toBe(before);
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`mock-selected-${width}.png`),
      fullPage: false,
    });
    await panel
      .getByRole("button", { name: "イベント模擬戦 0AP", exact: true })
      .click();
    const state = JSON.parse((await saved(page))!).state as GameState;
    expect(state.combat?.kind).toBe("mock");
    expect(state.players[0].ap).toBe(JSON.parse(before!).state.players[0].ap);
    expect(state.actions).toHaveLength(
      JSON.parse(before!).state.actions.length + 1,
    );
  });
}
for (const [id, expected, links] of [
  [2, "対象素材：月光草・星の砂", ["納品へ（0AP）"]],
  [3, "成立行動", ["採集へ（1AP）", "研究へ（1AP）"]],
  [4, "模擬戦", ["模擬戦へ（0AP）"]],
  [6, "能力", ["納品へ（0AP）"]],
  [9, "成立行動", ["研究へ（1AP）"]],
  [11, "指定素材", ["納品へ（0AP）"]],
  [12, "先着ルート：未確定", ["納品へ（0AP）"]],
] as const) {
  test(`stage1 event ${id} exposes relevant guidance only`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await load(page, eventGame(id));
    const card = page.locator(".event-preview");
    await expect(card).toContainText(expected);
    await expect(card.getByRole("button")).toHaveCount(links.length);
    const before = await saved(page);
    for (const link of links) {
      await card.getByRole("button", { name: link, exact: true }).click();
      expect(await saved(page)).toBe(before);
      await expect(
        page.locator(".actions-panel .selection-summary"),
      ).toContainText(
        link.startsWith("納品") || link.startsWith("模擬")
          ? "必要AP 0"
          : "必要AP 1",
      );
      await page.getByRole("button", { name: "キャンセルして戻る" }).click();
    }
    await noOverflow(page);
  });
}
