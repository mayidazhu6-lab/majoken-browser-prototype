import { expect, test } from "@playwright/test";
import fixture from "../tests/fixtures/v202-combat-save.json" with { type: "json" };
import { settleScreens } from "./helpers";
const oldKey = "majoken-save-rules-2.0.2",
  newKey = "majoken-save-rules-2.0.3";

test("新規AIのシード再現と旧セーブの継続・再保存・JSON再読込を両立する", async ({
  page,
}) => {
  const oldJSON = JSON.stringify(fixture.save);
  await page.addInitScript(
    ({ key, json }) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, json);
    },
    { key: oldKey, json: oldJSON },
  );
  const saved = (key: string) =>
    page.evaluate((key) => localStorage.getItem(key), key);
  const startNew = async () => {
    await page.goto("/");
    await page.getByRole("button", { name: /ゲーム開始/ }).click();
    await page.getByRole("checkbox", { name: "開発者モード" }).check();
    await page.getByLabel(/乱数シード/).fill("v20-battle-36");
    await page.getByRole("button", { name: "研究開始", exact: true }).click();
    await settleScreens(page);
    await page
      .getByRole("button", { name: "決闘（1AP）", exact: true })
      .click();
    await page
      .getByRole("button", { name: "公開決闘 1AP", exact: true })
      .click();
    await page.getByRole("button", { name: "持ち込まずに進む" }).click();
    await page.getByRole("button", { name: "火", exact: true }).click();
    await page.getByRole("button", { name: "属性と薬を確定" }).click();
  };
  await startNew();
  const first = await saved(newKey);
  const fresh = JSON.parse(first!).state;
  expect(fresh.rulesVersion).toBe("browser-2.0.3");
  expect(
    fresh.logs.some(
      (l: { text: string }) => l.text === "NPC戦闘属性の最高評価同点抽選",
    ),
  ).toBe(true);
  expect(await saved(oldKey)).toBe(oldJSON);
  await startNew();
  expect(await saved(newKey)).toBe(first);
  await page.reload();
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  expect(await saved(newKey)).toBe(first);
  await page
    .getByRole("button", { name: "旧v2.0.2の続きから", exact: true })
    .click();
  await settleScreens(page);
  await expect(page.locator(".combat-panel")).toBeVisible();
  expect(JSON.parse((await saved(oldKey))!).state).toEqual(fixture.save.state);
  await page.getByRole("button", { name: "水", exact: true }).click();
  await page.getByRole("button", { name: "属性と薬を確定" }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const continued = await saved(oldKey);
  const legacy = JSON.parse(continued!).state;
  expect(legacy.rulesVersion).toBe("browser-2.0.2");
  expect(legacy.combat.elemental.rounds.at(-1).sides[1].element).toBe("attack");
  expect(
    legacy.logs.some(
      (l: { text: string }) => l.text === "NPC戦闘属性の最高評価同点抽選",
    ),
  ).toBe(false);
  expect(await saved(newKey)).toBe(first);
  await page.reload();
  await page
    .getByRole("button", { name: "旧v2.0.2の続きから", exact: true })
    .click();
  expect(await saved(oldKey)).toBe(continued);
  await page.locator('input[type="file"]').setInputFiles({
    name: "legacy.json",
    mimeType: "application/json",
    buffer: Buffer.from(continued!),
  });
  expect(await saved(oldKey)).toBe(continued);
  expect(await saved(newKey)).toBe(first);
  await page.reload();
  await page
    .getByRole("button", { name: "旧v2.0.2の続きから", exact: true })
    .click();
  expect(await saved(oldKey)).toBe(continued);
});
