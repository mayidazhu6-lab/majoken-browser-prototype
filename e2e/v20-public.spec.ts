import { expect, test } from "@playwright/test";
import { V20_RELEASE_RULES_VERSION } from "../src/domain/config";
import { serialize } from "../src/domain/persistence";
import { createGame, dispatch } from "../src/domain/reducer";
import { settleScreens } from "./helpers";

for (const [seed, expected] of [
  ["v20-smoke-1", "成功"],
  ["v20-smoke-20", "失敗"],
]) {
  test(`v2.0で公開2巡を完了し、イベント${expected}から再開できる`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem("majoken-save-v2"))
        localStorage.setItem("majoken-save-v2", "legacy-save");
    });
    await page.goto("/");
    await page.getByRole("button", { name: /ゲーム開始/ }).click();
    await page.getByLabel(/乱数シード/).fill(seed);
    await page
      .getByRole("button", { name: /公開行動の試遊をはじめる/ })
      .click();
    await settleScreens(page);
    for (let round = 1; round <= 2; round++) {
      await expect(page.locator(".persistent-turn")).toContainText(
        `第${round}巡`,
      );
      await page.getByRole("button", { name: "採集", exact: true }).click();
      await page.getByRole("button", { name: "採集 1AP" }).click();
      await settleScreens(page);
      await page.getByRole("button", { name: /手番終了 \/ パス/ }).click();
    }
    const result = page.getByRole("dialog");
    const pending = page.getByRole("button", { name: "拒否", exact: true });
    await expect(pending).toHaveCount(1);
    await expect(page.locator(".persistent-turn")).toContainText(
      "取引の返答待ち",
    );
    await expect(result).toBeHidden();

    await page.reload();
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    await expect(page.locator(".persistent-turn")).toContainText(
      "取引の返答待ち",
    );
    await expect(result).toBeHidden();
    await pending.click();
    await expect(pending).toHaveCount(0);

    await expect(result).toContainText(expected);
    await page.reload();
    await page.getByRole("button", { name: "続きから" }).click();
    await expect(result).toContainText(expected);
    await result.getByRole("button", { name: "確認した" }).click();
    await expect(page.getByText("今夜、固有魔法を使いますか？")).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem("majoken-save-v2")),
    ).toBe("legacy-save");
  });
}

test("公開済みv2.0を旧ルールのまま再開し、修正版とは別に保存できる", async ({
  page,
}) => {
  const oldKey = "majoken-save-rules-2.0-final";
  const newKey = "majoken-save-rules-2.0.1";
  const original = createGame(
    {
      name: "アリア",
      seed: "v20-smoke-1",
      magic: "barrier",
      stats: { attack: 3, defense: 3, insight: 3 },
    },
    V20_RELEASE_RULES_VERSION,
  );
  let saved = dispatch(original, { type: "gather", player: 0 });
  saved = dispatch(saved, { type: "endTurn", player: 0 });
  saved = dispatch(saved, { type: "gather", player: 0 });
  await page.addInitScript(
    ({ oldKey, json }) => {
      if (localStorage.getItem(oldKey) === null)
        localStorage.setItem(oldKey, json);
    },
    { oldKey, json: serialize(saved) },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  await expect(page.locator(".persistent-turn")).toContainText("第2巡");
  await settleScreens(page);
  await page.getByRole("button", { name: /手番終了 \/ パス/ }).click();
  // The same seed in the tests above waits for a trade reply under 2.0.1.
  await expect(
    page.getByRole("dialog", { name: "共通イベントの結果" }),
  ).toContainText("成功");
  const oldSave = await page.evaluate(
    (key) => localStorage.getItem(key),
    oldKey,
  );
  expect(JSON.parse(oldSave!).state.rulesVersion).toBe(
    V20_RELEASE_RULES_VERSION,
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), newKey),
  ).toBeNull();

  await page.reload();
  await page.getByRole("button", { name: /ゲーム開始/ }).click();
  await page.getByRole("button", { name: /公開行動の試遊をはじめる/ }).click();
  const newSave = await page.evaluate(
    (key) => localStorage.getItem(key),
    newKey,
  );
  expect(newSave).not.toBeNull();
  await page.getByRole("button", { name: "旧v2.0の続きから" }).click();
  const result = page.getByRole("dialog", { name: "共通イベントの結果" });
  await expect(result).toContainText("成功");
  await result.getByRole("button", { name: "確認した" }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), newKey)).toBe(
    newSave,
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), oldKey),
  ).not.toBe(oldSave);
});
