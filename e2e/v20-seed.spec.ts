import { expect, test, type Page } from "@playwright/test";
import { dispatch } from "../src/domain/reducer";
import type { GameState } from "../src/domain/types";
import { settleScreens } from "./helpers";

async function openCreation(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /ゲーム開始/ }).click();
}

async function savedState(page: Page): Promise<GameState> {
  return page.evaluate(() => {
    const save = localStorage.getItem("majoken-save-rules-2.0.3");
    if (!save) throw new Error("保存データがありません");
    return JSON.parse(save).state;
  });
}

const debugMode = (page: Page) =>
  page.getByRole("checkbox", { name: "開発者モード", exact: true });
const seedInput = (page: Page) =>
  page.getByRole("textbox", { name: "乱数シード", exact: true });
const currentSeed = (page: Page) =>
  page.getByRole("textbox", { name: "現在の乱数シード", exact: true });
const researchStart = (page: Page) =>
  page.getByRole("button", { name: "研究開始", exact: true });

test("通常開始と開発者モードの空欄では新しいシードを生成する", async ({
  page,
}) => {
  await openCreation(page);
  await expect(debugMode(page)).not.toBeChecked();
  await expect(seedInput(page)).toHaveCount(0);
  await researchStart(page).click();
  const first = (await savedState(page)).seed;
  await expect(currentSeed(page)).toHaveCount(0);

  await openCreation(page);
  await debugMode(page).check();
  await expect(seedInput(page)).toHaveValue("");
  await researchStart(page).click();
  const second = (await savedState(page)).seed;
  await expect(currentSeed(page)).toHaveValue(second);

  await openCreation(page);
  await debugMode(page).check();
  await seedInput(page).fill("hidden-seed");
  await debugMode(page).uncheck();
  await expect(seedInput(page)).toHaveCount(0);
  await researchStart(page).click();
  const third = (await savedState(page)).seed;
  expect(new Set([first, second, third]).size).toBe(3);
  for (const seed of [first, second, third])
    expect(seed).toMatch(/^[0-9a-f]{32}$/);
});

test("指定シードで初期抽選を再現し、表示の切り替えと再開で乱数状態を維持する", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  async function startWith(seed: string) {
    await openCreation(page);
    await debugMode(page).check();
    await seedInput(page).fill(seed);
    await researchStart(page).click();
    await settleScreens(page);
    return savedState(page);
  }
  const first = await startWith("witches-2026");
  const repeated = await startWith("witches-2026");
  expect(first.seed).toBe("witches-2026");
  expect(repeated).toEqual(first);

  const other = await startWith("review-1");
  const deals = (state: GameState) =>
    state.players.map(({ longGoal, dailyGoal, inventory }) => ({
      longGoal,
      dailyGoal,
      materials: inventory.map(({ kind }) => kind),
    }));
  expect(deals(other)).not.toEqual(deals(first));
  await expect(currentSeed(page)).toHaveValue(other.seed);
  await page.getByRole("button", { name: "シードをコピー" }).click();
  await expect(page.getByText("乱数シードをコピーしました。")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    other.seed,
  );
  await debugMode(page).uncheck();
  await expect(currentSeed(page)).toHaveCount(0);
  expect(await savedState(page)).toEqual(other);

  await page.reload();
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  await settleScreens(page);
  await debugMode(page).check();
  await expect(currentSeed(page)).toHaveValue(other.seed);
  await page.getByRole("button", { name: "採集（1AP）", exact: true }).click();
  await page.getByRole("button", { name: "採集 1AP" }).click();
  expect(await savedState(page)).toEqual(
    dispatch(other, { type: "gather", player: 0 }),
  );
});
