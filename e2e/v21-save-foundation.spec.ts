import { expect, test } from "@playwright/test";
import { createGame, dispatch } from "../src/domain/reducer";
import { serialize } from "../src/domain/persistence";
import { V21_RULES_VERSION } from "../src/domain/config";
import { settleScreens } from "./helpers";

const key = "majoken-save-rules-2.1";
const setup = {
  name: "アリア",
  seed: "v21-storage-browser",
  magic: "barrier",
  stats: { attack: 3, defense: 3, insight: 3 },
} as const;
const slots = [
  ["browser-2.0", "majoken-save-rules-2.0-final", "旧v2.0の続きから"],
  ["browser-2.0.1", "majoken-save-rules-2.0.1", "旧v2.0.1の続きから"],
  ["browser-2.0.2", "majoken-save-rules-2.0.2", "旧v2.0.2の続きから"],
  ["browser-2.0.3", "majoken-save-rules-2.0.3", "旧v2.0.3の続きから"],
  ["browser-2.0.4", "majoken-save-rules-2.0.4", "旧v2.0.4の続きから"],
] as const;

test("新規v2.1と旧5版を別枠で再開・保存できる", async ({ page }) => {
  const old = slots.map(([version, slot]) => [
    slot,
    serialize(createGame(setup, version)),
  ]);
  await page.addInitScript((saves) => {
    for (const [slot, json] of saves)
      if (localStorage.getItem(slot) === null) localStorage.setItem(slot, json);
  }, old);
  await page.goto("/");
  await page.getByRole("button", { name: /ゲーム開始/ }).click();
  await page
    .getByRole("checkbox", { name: "開発者モード", exact: true })
    .check();
  await page.getByLabel("乱数シード", { exact: true }).fill(setup.seed);
  await page.getByRole("button", { name: "研究開始", exact: true }).click();
  await settleScreens(page);
  const fresh = await page.evaluate((slot) => localStorage.getItem(slot), key);
  expect(JSON.parse(fresh!)).toMatchObject({
    format: "majoken-save",
    version: 2,
    state: { rulesVersion: V21_RULES_VERSION },
  });
  for (const [version, slot, button] of slots) {
    await page.reload();
    await page.getByRole("button", { name: button, exact: true }).click();
    await settleScreens(page);
    await expect(page.locator("footer")).toContainText(version);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    expect(
      await page.evaluate((slot) => localStorage.getItem(slot), slot),
    ).toBe(old.find(([savedSlot]) => savedSlot === slot)![1]);
    expect(await page.evaluate((slot) => localStorage.getItem(slot), key)).toBe(
      fresh,
    );
  }
  await page.reload();
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  await expect(page.locator("footer")).toContainText(V21_RULES_VERSION);
  for (const [slot, json] of old)
    expect(
      await page.evaluate((slot) => localStorage.getItem(slot), slot),
    ).toBe(json);
});

test("v2.1の保存失敗時は進行を止め、同じ結果だけを再保存する", async ({
  page,
}) => {
  const initial = createGame(setup, V21_RULES_VERSION);
  const saved = serialize(initial);
  const expected = dispatch(initial, { type: "gather", player: 0 });
  await page.addInitScript(
    ({ key, saved }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, saved);
    },
    { key, saved },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  await settleScreens(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).v21RestoreStorage = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (slot, value) {
      if (slot === "majoken-save-rules-2.1")
        throw new DOMException("test quota", "QuotaExceededError");
      return original.call(this, slot, value);
    };
  });
  await page.getByRole("button", { name: "採集（1AP）", exact: true }).click();
  await page.getByRole("button", { name: "採集 1AP", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "保存に失敗しました", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate((slot) => localStorage.getItem(slot), key)).toBe(
    saved,
  );
  await page.evaluate(() => (window as any).v21RestoreStorage());
  await page.getByRole("button", { name: "保存を再試行", exact: true }).click();
  const retried = await page.evaluate(
    (slot) => localStorage.getItem(slot),
    key,
  );
  expect(JSON.parse(retried!).state).toEqual(
    JSON.parse(JSON.stringify(expected)),
  );
  await page.reload();
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  expect(await page.evaluate((slot) => localStorage.getItem(slot), key)).toBe(
    retried,
  );
});
