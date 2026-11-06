import { settleScreens } from "./helpers";
import { selectItems } from "./helpers";
import { test, expect } from "@playwright/test";
import { simulationAction } from "../src/domain/simulation";
import { LABELS, STATS } from "../src/domain/config";
import type { GameState } from "../src/domain/types";
async function state(
  page: import("@playwright/test").Page,
): Promise<GameState> {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem("majoken-save-v2")!).state,
  );
}
test("キャラクター作成・秘匿表示・保存再開・JSON出力", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "ゲーム開始 →", exact: true }).click();
  await page.getByLabel("乱数シード").fill("lab-77");
  if (
    await page
      .getByRole("button", { name: "ゲーム開始 →", exact: true })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "ゲーム開始 →", exact: true })
      .click();
  await page.getByRole("button", { name: /8日間の研究をはじめる/ }).click();
  await settleScreens(page);
  await expect(
    page.getByRole("heading", { name: "今日、何を研究する？" }),
  ).toBeVisible();
  await expect(page.locator(".witch-card")).toHaveCount(4);
  await expect(page.locator(".debug")).toHaveCount(0);
  const before = await state(page);
  await page.getByRole("button", { name: "採集", exact: true }).click();
  await page.getByRole("button", { name: /採集 1AP/ }).click();
  await settleScreens(page);
  expect((await state(page)).players[0].ap).toBe(before.players[0].ap - 1);
  await page.reload();
  await page.getByRole("button", { name: "続きから" }).click();
  await settleScreens(page);
  expect((await state(page)).players[0].ap).toBe(before.players[0].ap - 1);
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON保存", exact: true }).click();
  expect((await promise).suggestedFilename()).toContain("majoken-day");
  await page.getByLabel("開発者モード", { exact: true }).check();
  await expect(page.locator(".debug")).toContainText("lab-77");
  expect(errors).toEqual([]);
});
