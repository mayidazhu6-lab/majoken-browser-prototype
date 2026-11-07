import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dispatch } from "../src/domain/reducer";
import { serialize } from "../src/domain/persistence";
import { V20_NPC_RULES_VERSION } from "../src/domain/config";
import type { GameState } from "../src/domain/types";
import {
  midpointMorningStates,
  sixthMorning,
} from "../tests/fixtures/midpointMorning";
const key = "majoken-save-rules-2.0.4",
  uiKey = "majoken-ui-rules-2.0.4";
function view(state: GameState, day: number) {
  return {
    version: 1,
    key: JSON.stringify([state.setup, state.actions]),
    graduation: false,
    day,
    actionResult: [],
    battleStep: "intro",
  };
}
async function load(page: Page, state: GameState, day?: number, old = false) {
  const saveKey = old ? "majoken-save-rules-2.0.3" : key;
  const presentationKey = old ? "majoken-ui-rules-2.0.3" : uiKey;
  await page.addInitScript(
    ({ saveKey, presentationKey, json, presentation }) => {
      if (!localStorage.getItem(saveKey)) localStorage.setItem(saveKey, json);
      if (presentation && !localStorage.getItem(presentationKey))
        localStorage.setItem(presentationKey, presentation);
    },
    {
      saveKey,
      presentationKey,
      json: serialize(state),
      presentation: day === undefined ? null : JSON.stringify(view(state, day)),
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "続きから", exact: true }).click();
}
async function saved(page: Page, saveKey = key) {
  return page.evaluate((key) => localStorage.getItem(key), saveKey);
}
const notice = (page: Page) =>
  page.getByRole("region", { name: "後半戦の案内", exact: true });
for (const width of [1440, 390, 320]) {
  test(`day-four dawn to fifth morning, keyboard confirmation and resume ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    const { day4Ho } = midpointMorningStates();
    await load(page, day4Ho, 4);
    await expect(notice(page)).toHaveCount(0);
    await page.getByRole("button", { name: /課題を判定して夜明けへ/ }).click();
    const dawn = dispatch(day4Ho, { type: "advance", pauseAtDawn: true });
    expect(JSON.parse((await saved(page))!).state).toEqual(
      JSON.parse(serialize(dawn)).state,
    );
    await expect(notice(page)).toHaveCount(0);
    await page.getByRole("button", { name: /次の日へ/ }).click();
    const morning = dispatch(dawn, { type: "advance", pauseAtDawn: true });
    const before = await saved(page);
    expect(JSON.parse(before!).state).toEqual(
      JSON.parse(serialize(morning)).state,
    );
    await expect(notice(page)).toHaveCount(1);
    await expect(
      notice(page).getByRole("heading", { name: "後半戦開幕！", exact: true }),
    ).toBeVisible();
    await expect(notice(page)).toContainText(
      "研究生活も残り4日。首席を目指す戦いは、ここからさらに激しくなる！",
    );
    await expect(notice(page).locator(".midpoint-rewards")).toContainText(
      "+1FP",
    );
    await expect(notice(page).locator(".midpoint-rewards")).toContainText(
      "+2FP",
    );
    await expect(notice(page)).toContainText("挑戦側・被挑戦側");
    await expect(notice(page)).toContainText("秘匿行動の襲撃");
    await expect(
      page.getByRole("heading", { name: "5日目の今日の課題", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".briefing")).toContainText("達成条件：");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "day");
    await page.reload();
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    await expect(notice(page)).toHaveCount(1);
    expect(await saved(page)).toBe(before);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const noClip = await notice(page).evaluate((el) =>
      Array.from(el.querySelectorAll(".midpoint-rewards > div")).every(
        (child) => child.scrollWidth <= child.clientWidth,
      ),
    );
    expect(noClip).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath(`midpoint-${width}.png`),
      fullPage: true,
    });
    // The existing morning heading receives focus; the next Tab reaches the sole confirm.
    await page
      .getByRole("heading", { name: "後半戦開幕！", exact: true })
      .focus();
    await page.keyboard.press("Tab");
    const confirm = page.getByRole("button", {
      name: "確認して進む",
      exact: true,
    });
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(notice(page)).toHaveCount(0);
    await expect(page.locator(".briefing")).toHaveCount(0);
    expect(await saved(page)).toBe(before);
    const presentation = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      uiKey,
    );
    expect(presentation.day).toBe(5);
    expect(Object.keys(presentation).sort()).toEqual([
      "actionResult",
      "battleStep",
      "day",
      "graduation",
      "key",
      "version",
    ]);
    await page.reload();
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    await expect(notice(page)).toHaveCount(0);
    await expect(page.locator(".briefing")).toHaveCount(0);
    expect(await saved(page)).toBe(before);
    await expect(
      page.getByRole("button", { name: "採集（1AP）", exact: true }),
    ).toBeVisible();
    if (width === 390) {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "JSON保存", exact: true }).click(),
      ]);
      const exported = readFileSync((await download.path())!, "utf8");
      expect(JSON.parse(exported).presentation.day).toBe(5);
      await page
        .getByLabel("JSON読込", { exact: true })
        .setInputFiles({
          name: "midpoint.json",
          mimeType: "application/json",
          buffer: Buffer.from(exported),
        });
      await expect(notice(page)).toHaveCount(0);
      expect(await saved(page)).toBe(before);
    }
  });
}
for (const [label, day] of [
  ["fourth", 4],
  ["sixth", 6],
] as const) {
  test(`${label} morning has its normal briefing without a midpoint notice`, async ({
    page,
  }) => {
    const state =
      day === 4 ? midpointMorningStates().day4Morning : sixthMorning();
    await load(page, state, day - 1);
    await expect(notice(page)).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        name: `${day}日目の今日の課題`,
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "確認した", exact: true }).click();
    await expect(page.locator(".briefing")).toHaveCount(0);
  });
}
test("missing UI history does not force the notice, while an actual day transition can show it", async ({
  page,
}) => {
  const { day5Morning } = midpointMorningStates();
  await load(page, day5Morning);
  const before = await saved(page);
  await expect(notice(page)).toHaveCount(0);
  await page.getByRole("button", { name: "確認した", exact: true }).click();
  expect(await saved(page)).toBe(before);
});
test("old +1FP save retains its normal fifth-day briefing", async ({
  page,
}) => {
  const state = midpointMorningStates(V20_NPC_RULES_VERSION).day5Morning;
  await load(page, state, 4, true);
  const oldKey = "majoken-save-rules-2.0.3";
  const before = await saved(page, oldKey);
  await expect(notice(page)).toHaveCount(0);
  await page.getByRole("button", { name: "確認した", exact: true }).click();
  expect(await saved(page, oldKey)).toBe(before);
  await page.getByRole("button", { name: /決闘（1AP）/ }).click();
  await expect(page.locator(".actions-panel")).toContainText("全日＋1FP");
});
test("an old day-four save with no UI history still sees the actual fifth-day transition", async ({
  page,
}) => {
  await load(page, midpointMorningStates().day4Ho);
  await page.getByRole("button", { name: /課題を判定して夜明けへ/ }).click();
  await page.getByRole("button", { name: /次の日へ/ }).click();
  await expect(notice(page)).toHaveCount(1);
});
test("already started fifth day is not forced back into the announcement", async ({
  page,
}) => {
  const state = dispatch(midpointMorningStates().day5Morning, {
    type: "withdraw",
    player: 0,
  });
  await load(page, state, 4);
  await expect(notice(page)).toHaveCount(0);
  await page.getByRole("button", { name: "確認した", exact: true }).click();
  expect(await saved(page)).toBe(serialize(state));
});
