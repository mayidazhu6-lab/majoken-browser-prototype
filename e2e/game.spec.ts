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
  await page.getByLabel("乱数シード").fill("lab-77");
  await page.getByRole("button", { name: /8日間の研究をはじめる/ }).click();
  await expect(
    page.getByRole("heading", { name: "今日、何を研究する？" }),
  ).toBeVisible();
  await expect(page.locator(".witch-card")).toHaveCount(4);
  await expect(page.locator(".debug")).toHaveCount(0);
  const before = await state(page);
  await page.getByRole("button", { name: /採集 1AP/ }).click();
  expect((await state(page)).players[0].ap).toBe(before.players[0].ap - 1);
  await page.reload();
  await page.getByRole("button", { name: "続きから" }).click();
  expect((await state(page)).players[0].ap).toBe(before.players[0].ap - 1);
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON保存", exact: true }).click();
  expect((await promise).suggestedFilename()).toContain("majoken-day");
  await page.getByLabel("開発者モード", { exact: true }).check();
  await expect(page.locator(".debug")).toContainText("lab-77");
  expect(errors).toEqual([]);
});
test("画面の操作だけで8日間を完走", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("乱数シード").fill("lab-77");
  await page.getByRole("button", { name: /8日間の研究をはじめる/ }).click();
  let steps = 0;
  while (steps++ < 300) {
    const s = await state(page);
    if (s.phase === "ended") {
      expect(s.day).toBe(8);
      expect(s.result?.reason).toBe("completed");
      break;
    }
    const a = simulationAction(s);
    switch (a.type) {
      case "forced":
        await page
          .getByRole("button", { name: "命令の採集を実行", exact: true })
          .click();
        break;
      case "challengeReply":
        await page
          .getByRole("button", { name: "対戦する", exact: true })
          .click();
        break;
      case "round":
        await page
          .locator(".stance-options")
          .getByRole("button", { name: LABELS[a.stance], exact: true })
          .click();
        await page.getByRole("button", { name: /手を確定/ }).click();
        break;
      case "reward":
        await page
          .getByRole("button", {
            name:
              s.combat?.kind === "public"
                ? "既定の能力を選ぶ"
                : "アイテムを1個強奪",
            exact: true,
          })
          .click();
        break;
      case "reserve":
        await page.getByRole("button", { name: "納品", exact: true }).click();
        for (const id of a.items)
          await page
            .locator(".item-picker button")
            .filter({ hasText: new RegExp(`#${id}$`) })
            .click();
        for (const k of STATS)
          if (a.stats[k])
            await page
              .locator(".actions-panel")
              .getByLabel(LABELS[k], { exact: true })
              .fill(String(a.stats[k]));
        await page
          .getByRole("button", { name: "仮納品する", exact: true })
          .click();
        break;
      case "gather":
        await page
          .getByRole("button", { name: "採集・研究", exact: true })
          .click();
        await page.getByRole("button", { name: /採集 1AP/ }).click();
        break;
      case "research":
        await page
          .getByRole("button", { name: "採集・研究", exact: true })
          .click();
        await page
          .locator(".action-card")
          .filter({
            has: page.getByRole("heading", {
              name: `${LABELS[a.stat]}を研究`,
              exact: true,
            }),
          })
          .getByRole("button")
          .click();
        break;
      case "tradeReply":
        await page
          .getByRole("button", { name: "受諾", exact: true })
          .first()
          .click();
        break;
      case "unlock":
        await page
          .getByRole("button", { name: requireName(a.recipe), exact: true })
          .click();
        break;
      case "night":
        await page
          .locator(".night-options")
          .getByRole("button", { name: LABELS[a.choice.kind], exact: true })
          .click();
        if (a.choice.kind === "brew") {
          for (const id of a.choice.recipes!) {
            await page.getByLabel("レシピ", { exact: true }).selectOption(id);
            await page
              .getByRole("button", { name: "作成予定に追加", exact: true })
              .click();
          }
        }
        await page
          .getByRole("button", { name: "秘匿行動を確定", exact: true })
          .click();
        break;
      case "endTurn":
      case "advance":
        await page.locator(".progression button.primary").click();
        break;
      default:
        throw Error("UI test action unsupported " + a.type);
    }
    await expect(page.locator(".alert.error")).toHaveCount(0);
  }
  expect(steps).toBeLessThan(300);
  await expect(page.locator(".final-results")).toBeVisible();
  await page.screenshot({ path: "docs/reports/game-end.png", fullPage: true });
  expect(errors).toEqual([]);
});
import { recipe } from "../src/domain/items";
function requireName(id: string) {
  return recipe(id)!.name;
}
