import { expect, test, type Page } from "@playwright/test";
import { createGame, currentPlayer, dispatch } from "../src/domain/reducer";
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
    await expect(health.locator(".health-gem")).toHaveCount(3);
    await expect(health.locator(".health-gem.filled")).toHaveCount(3);
    await expect(health).toContainText("3 / 3");
    const overview = page.locator(".event-preview");
    await expect(overview).toContainText("不足6個");
    await expect(overview).toContainText("月光草 0 / 1個");
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`home-${width}.png`),
      fullPage: false,
    });
    const jump = page.getByRole("button", {
      name: "行動を選ぶ 採集・研究など ↓",
      exact: true,
    });
    if (width === 390) {
      await expect(jump).toBeInViewport();
      expect((await hud.boundingBox())!.height).toBeLessThanOrEqual(80);
      const unchanged = await saved(page);
      await jump.click();
      const gather = page.getByRole("button", {
        name: "採集（1AP）",
        exact: true,
      });
      await expect(gather).toBeInViewport();
      await expect(gather).toBeFocused();
      expect(await saved(page)).toBe(unchanged);
      await page.screenshot({
        path: testInfo.outputPath(`actions-${width}.png`),
        fullPage: false,
      });
      await page.evaluate(() => {
        const el = document.querySelector(".turn-hud-anchor")!;
        window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top);
      });
    } else {
      await expect(jump).toBeHidden();
      await expect(
        page.getByRole("button", { name: "採集（1AP）", exact: true }),
      ).toBeInViewport();
    }
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
      panel.getByRole("button", { name: "公開決闘 1AP", exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button", {
        name: "通常の公開決闘に切り替える",
        exact: true,
      }),
    ).toBeVisible();
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

for (const width of [1440, 390])
  for (const mode of ["public", "mock"] as const) {
    test(`review P2 explicit switches and confirm ${mode} ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await load(page, eventGame(10));
      const before = await saved(page);
      await page
        .locator(".event-preview")
        .getByRole("button", { name: "模擬戦へ（0AP）", exact: true })
        .click();
      const panel = page.locator(".actions-panel");
      const target = panel.getByRole("combobox", {
        name: "対戦相手",
        exact: true,
      });
      await target.selectOption("2");
      await panel
        .getByRole("button", {
          name: "通常の公開決闘に切り替える",
          exact: true,
        })
        .click();
      await expect(panel.locator(".selection-summary")).toContainText(
        "通常の公開決闘 · 必要AP 1",
      );
      await expect(target).toHaveValue("-1");
      await expect(
        panel.getByRole("button", { name: "公開決闘 1AP", exact: true }),
      ).toBeDisabled();
      await expect(
        panel.getByRole("button", { name: "イベント模擬戦 0AP", exact: true }),
      ).toHaveCount(0);
      expect(await saved(page)).toBe(before);
      await target.selectOption("3");
      await panel
        .getByRole("button", {
          name: "イベント模擬戦に切り替える",
          exact: true,
        })
        .click();
      await expect(target).toHaveValue("-1");
      await expect(
        panel.getByRole("button", { name: "イベント模擬戦 0AP", exact: true }),
      ).toBeDisabled();
      await expect(
        panel.getByRole("button", { name: "公開決闘 1AP", exact: true }),
      ).toHaveCount(0);
      expect(await saved(page)).toBe(before);
      // Leaving an unselected target must not carry the sentinel into another action.
      await page.getByRole("button", { name: "キャンセルして戻る" }).click();
      await page
        .getByRole("button", { name: "魔女間取引（0AP）", exact: true })
        .click();
      await expect(panel.locator(".trade-preview")).toContainText(
        "提案内容の確認",
      );
      expect(await saved(page)).toBe(before);
      await page.getByRole("button", { name: "キャンセルして戻る" }).click();
      await page
        .locator(".event-preview")
        .getByRole("button", { name: "模擬戦へ（0AP）", exact: true })
        .click();
      if (mode === "public")
        await panel
          .getByRole("button", {
            name: "通常の公開決闘に切り替える",
            exact: true,
          })
          .click();
      await target.selectOption("2");
      expect(await saved(page)).toBe(before);
      await noOverflow(page);
      await panel.screenshot({
        path: testInfo.outputPath(`mode-${mode}-${width}.png`),
      });
      const action = {
        type: "duel",
        player: 0,
        target: 2,
        ...(mode === "mock" ? { mock: true } : {}),
      } as const;
      const expected = dispatch(JSON.parse(before!).state, action);
      await panel
        .getByRole("button", {
          name: mode === "mock" ? "イベント模擬戦 0AP" : "公開決闘 1AP",
          exact: true,
        })
        .click();
      const after = JSON.parse((await saved(page))!).state as GameState;
      expect(after).toEqual(expected);
      expect(after.players[0].ap).toBe(mode === "public" ? 1 : 2);
      expect(after.publicTurn.acted).toBe(mode === "public");
      expect(after.combat?.kind).toBe(mode);
      expect(after.event.mock).toEqual([]);
    });
  }
for (const [width, height] of [
  [390, 740],
  [320, 640],
]) {
  test(`review P3 action entry stays above fold ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await load(page, eventGame(10));
    const before = await saved(page);
    const jump = page.getByRole("button", {
      name: "行動を選ぶ 採集・研究など ↓",
      exact: true,
    });
    await expect(jump).toBeInViewport();
    await jump.click();
    await expect(
      page.getByRole("button", { name: "採集（1AP）", exact: true }),
    ).toBeInViewport();
    expect(await saved(page)).toBe(before);
    await noOverflow(page);
  });
}
