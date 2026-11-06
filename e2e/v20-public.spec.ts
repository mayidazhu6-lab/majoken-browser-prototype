import { expect, test } from "@playwright/test";
import { V20_RELEASE_RULES_VERSION } from "../src/domain/config";
import { serialize } from "../src/domain/persistence";
import { createGame, dispatch } from "../src/domain/reducer";
import { settleScreens } from "./helpers";

for (const [seed, expected] of [
  ["v20-smoke-6", "成功"],
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
    await page.getByRole("checkbox", { name: "開発者モード" }).check();
    await page.getByLabel(/乱数シード/).fill(seed);
    await page.getByRole("button", { name: "研究開始", exact: true }).click();
    await settleScreens(page);
    await expect(page.locator(".event-preview")).toContainText(
      "今日の共通イベント",
    );
    await expect(page.locator(".witch-card .fp")).toHaveCount(4);
    await expect(page.locator(".witch-card.you")).not.toContainText("AP");
    const menu = page.getByRole("navigation", { name: "共通メニュー" });
    await menu.getByRole("button", { name: /持ち物/ }).click();
    const inventory = page.getByRole("dialog", { name: "持ち物" });
    await expect(
      inventory.getByRole("button", { name: "素材", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const potions = inventory.getByRole("button", { name: "薬", exact: true });
    await potions.click();
    await expect(potions).toHaveAttribute("aria-pressed", "true");
    await inventory
      .getByRole("button", { name: "閉じる", exact: true })
      .click();
    const actions = page.getByRole("navigation", { name: "公開行動" });
    const panel = page.locator(".actions-panel");
    for (const label of [
      "採集（1AP）",
      "研究（1AP）",
      "納品（0AP）",
      "購買部（1AP）",
      "魔女間取引（0AP）",
      "決闘（1AP）",
    ])
      await expect(
        actions.getByRole("button", { name: label, exact: true }),
      ).toBeVisible();

    await actions
      .getByRole("button", { name: "採集（1AP）", exact: true })
      .click();
    await page.getByRole("button", { name: "キャンセルして戻る" }).click();
    await expect(panel).toContainText("残りAP 2 / 2");

    for (let round = 1; round <= 2; round++) {
      await settleScreens(page);
      await expect(panel).toContainText(`第${round}巡 / 全2巡`);
      await expect(panel).toContainText(`残りAP ${3 - round} / 2`);
      await expect(panel).toContainText("この巡の1AP行動：未使用");
      await actions
        .getByRole("button", { name: "採集（1AP）", exact: true })
        .click();
      await page.getByRole("button", { name: "採集 1AP" }).click();
      await settleScreens(page);
      if (round === 1) {
        await page.reload();
        await page
          .getByRole("button", { name: "続きから", exact: true })
          .click();
        await settleScreens(page);
        await expect(panel).toContainText("残りAPは次の巡に持ち越します。");
      } else {
        await expect(panel).toContainText("残りAPはありません。");
      }
      await expect(panel).toContainText(`残りAP ${2 - round} / 2`);
      await expect(panel).toContainText("この巡の1AP行動：使用済み");
      await actions
        .getByRole("button", { name: /採集（1AP）.*詳細のみ/ })
        .click();
      await expect(
        panel.getByRole("button", { name: "採集 1AP" }),
      ).toBeDisabled();
      await page.getByRole("button", { name: "キャンセルして戻る" }).click();
      await actions
        .getByRole("button", { name: "納品（0AP）", exact: true })
        .click();
      await expect(
        panel.getByRole("button", { name: "自分の予約をすべて撤回（0AP）" }),
      ).toBeEnabled();
      await page.getByRole("button", { name: "キャンセルして戻る" }).click();
      await page.getByRole("button", { name: /手番終了 \/ パス/ }).click();
    }
    const result = page.getByRole("dialog", { name: "共通イベントの結果" });
    const tradeDialog = page.getByRole("dialog", { name: /からの取引提案/ });
    await expect(tradeDialog).toBeVisible();
    const pending = tradeDialog.getByRole("button", {
      name: "拒否",
      exact: true,
    });
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
  const newKey = "majoken-save-rules-2.0.3";
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
  await settleScreens(page);
  await expect(page.locator(".persistent-turn")).toContainText("第2巡");
  await page.getByRole("button", { name: /手番終了 \/ パス/ }).click();
  // The same seed in the tests above waits for a trade reply under 2.0.2.
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
  await page.getByRole("button", { name: "研究開始", exact: true }).click();
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
