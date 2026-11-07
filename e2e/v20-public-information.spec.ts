import { expect, test, type Page } from "@playwright/test";
import { createGame, currentPlayer, dispatch } from "../src/domain/reducer";
import { serialize, replay } from "../src/domain/persistence";
import { MATERIALS, V20_LABELS, LABELS } from "../src/domain/config";
import type { GameState, Setup, Action } from "../src/domain/types";
import fixture from "../tests/fixtures/v203-late-duel.json" with { type: "json" };
import { settleScreens } from "./helpers";

async function load(page: Page, state: GameState) {
  await page.addInitScript((json) => {
    if (!localStorage.getItem("majoken-save-rules-2.0.4"))
      localStorage.setItem("majoken-save-rules-2.0.4", json);
  }, serialize(state));
  await page.goto("/");
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  await settleScreens(page);
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
function eventGame() {
  for (let seed = 0; seed < 1000; seed++) {
    const s = createGame(
      {
        name: "アリア",
        seed: `ui3-${seed}`,
        magic: "barrier",
        stats: { attack: 3, defense: 3, insight: 3 },
      },
      "browser-2.0.4",
    );
    if (s.event.id === 5 && currentPlayer(s) === 0) return s;
  }
  throw Error("No event seed");
}
for (const width of [1440, 390]) {
  test(`public guidance, delivery and trade at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await load(page, eventGame());
    const saved = () =>
      page.evaluate(() => localStorage.getItem("majoken-save-rules-2.0.4"));
    let before = await saved();
    await expect(page.locator(".persistent-turn")).toContainText("午前");
    await expect(page.locator(".risk")).toContainText(
      "あと3回の失敗で研究所崩壊",
    );
    await page
      .getByRole("button", { name: "納品（0AP）", exact: true })
      .click();
    const panel = page.locator(".actions-panel");
    await expect(panel.locator(".selection-summary")).toContainText("必要AP 0");
    await expect(panel.locator(".event-panel")).toContainText("月光炉の暴走");
    await expect(panel.locator(".event-metrics")).toContainText("不足6個");
    await expect(panel.locator(".event-panel")).toContainText(
      "月光草 0 / 1個（不足1個）",
    );
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`delivery-${width}.png`),
      fullPage: true,
    });
    expect(await saved()).toBe(before);
    const initial = JSON.parse(before!).state as GameState;
    const donated = initial.players[0].inventory.find((i) =>
      MATERIALS.includes(i.kind),
    )!;
    const donatedName = V20_LABELS[donated.kind] ?? LABELS[donated.kind];
    await panel.getByLabel(`${donatedName}の数量`, { exact: true }).fill("1");
    await panel
      .getByRole("button", { name: "仮納品する（0AP）", exact: true })
      .click();
    await settleScreens(page);
    const reserved = JSON.parse((await saved())!).state as GameState;
    expect(reserved.players[0].ap).toBe(initial.players[0].ap);
    expect(reserved.event.reservations[0].items).toEqual([donated.id]);
    await page
      .getByRole("button", { name: "納品（0AP）", exact: true })
      .click();
    await expect(panel.locator(".event-metrics")).toContainText("不足5個");
    await panel
      .getByRole("button", { name: "自分の予約をすべて撤回（0AP）" })
      .click();
    await settleScreens(page);
    await page
      .getByRole("button", { name: "納品（0AP）", exact: true })
      .click();
    await expect(panel.locator(".event-metrics")).toContainText("不足6個");
    before = await saved();
    await page.getByRole("button", { name: "キャンセルして戻る" }).click();
    await page
      .getByRole("button", { name: "魔女間取引（0AP）", exact: true })
      .click();
    const preview = panel.locator(".trade-preview");
    await expect(preview).toContainText("空の取引は不可");
    await page
      .getByText("自分が渡す数・相手から受け取る数を入力", { exact: true })
      .click();
    const state = JSON.parse(before!).state as GameState;
    const item = state.players[0].inventory.find((i) =>
      MATERIALS.includes(i.kind),
    )!;
    const name = V20_LABELS[item.kind] ?? LABELS[item.kind];
    await page.getByLabel(`${name} 提供数`, { exact: true }).fill("1");
    await expect(preview).toContainText(`あなたが渡す：${name} ×1`);
    await expect(preview).toContainText("から受け取る：なし");
    await expect(
      panel.getByRole("button", { name: "固定条件で提案（0AP）" }),
    ).toBeEnabled();
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`trade-${width}.png`),
      fullPage: true,
    });
    // Changing presentation and validating the proposal never mutates saved state/RNG.
    expect(await saved()).toBe(before);
    const expected = dispatch(state, {
      type: "trade",
      player: 0,
      target: 1,
      offer: [item.id],
      request: {},
    });
    await panel.getByRole("button", { name: "固定条件で提案（0AP）" }).click();
    await settleScreens(page);
    const after = JSON.parse((await saved())!).state as GameState;
    expect(after.players[0].ap).toBe(expected.players[0].ap);
    expect(after.actions).toEqual(expected.actions);
    expect(after.rng).toEqual(expected.rng);
    await page.reload();
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    await settleScreens(page);
    expect(JSON.parse((await saved())!).state).toEqual(after);
  });
  test(`combat relationship is visible at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await load(
      page,
      replay(
        fixture.setup as Setup,
        fixture.actionsBeforeWin as Action[],
        "browser-2.0.4",
      ),
    );
    await expect(page.locator(".risk")).toContainText(
      "あと3回の失敗で研究所崩壊",
    );
    const affinity = page.getByRole("complementary", { name: "戦闘の相性" });
    await expect(affinity).toContainText("火 → 風");
    await expect(affinity).toContainText("風 → 水");
    await expect(affinity).toContainText("水 → 火");
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`combat-${width}.png`),
      fullPage: true,
    });
  });
}
