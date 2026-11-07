import { expect, test } from "@playwright/test";
import {
  V20_PLAYTEST_RULES_VERSION,
  V20_RELEASE_RULES_VERSION,
} from "../src/domain/config";
import { serialize } from "../src/domain/persistence";
import { createGame } from "../src/domain/reducer";
import { settleScreens } from "./helpers";

const title = "遊び方・ルール説明";
const setup = {
  name: "アリア",
  seed: "v20-smoke-1",
  magic: "barrier",
  stats: { attack: 3, defense: 3, insight: 3 },
} as const;

for (const [device, width, height] of [
  ["PC", 1440, 1000],
  ["スマホ", 390, 740],
] as const) {
  test.describe(device, () => {
    test.use({ viewport: { width, height } });

    test("タイトルとプレイ中からルールを開き、閉じると同じ画面へ戻る", async ({
      page,
    }) => {
      await page.goto("/");
      const opener = page.getByRole("button", { name: title, exact: true });
      const guide = page.getByRole("dialog", { name: title, exact: true });
      const start = page.getByRole("button", { name: /ゲーム開始/ });
      await expect(start).toBeVisible();
      await expect(opener).toBeVisible();
      const startBox = (await start.boundingBox())!;
      const guideButtonBox = (await opener.boundingBox())!;
      expect(guideButtonBox.x).toBeCloseTo(startBox.x);
      expect(guideButtonBox.width).toBeCloseTo(startBox.width);
      await opener.click();
      await expect(guide).toContainText("ルール v2.0.4");
      await expect(guide.locator("details[open]")).toHaveCount(1);
      await guide.getByText("1日の流れ", { exact: true }).click();
      await expect(
        guide.getByText(/結界は、自分かほかの魔女1人/),
      ).toBeVisible();
      await expect(guide.getByText(/予知を使った魔女が/)).toBeVisible();
      await guide.getByText("1日分のプレイ例", { exact: true }).click();
      await expect(
        guide.getByText("その日の採集で、素材を合計2個以上獲得する。"),
      ).toBeVisible();
      const bounds = (await guide.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
      const close = guide.getByRole("button", { name: "閉じる", exact: true });
      await expect(close).toBeInViewport();
      await close.click();
      await expect(guide).toHaveCount(0);
      await expect(opener).toBeFocused();

      await start.click();
      await page.getByRole("checkbox", { name: "開発者モード" }).check();
      await page.getByLabel(/乱数シード/).fill(setup.seed);
      await page.getByRole("button", { name: "研究開始", exact: true }).click();
      await settleScreens(page);
      await page
        .getByRole("button", { name: "購買部（1AP）", exact: true })
        .click();
      const material = page.locator(".center-column select");
      await material.selectOption("dew");
      const before = await page.evaluate(() =>
        localStorage.getItem("majoken-save-rules-2.0.4"),
      );
      await opener.click();
      await expect(guide).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(opener).toBeFocused();
      await expect(material).toHaveValue("dew");
      expect(
        await page.evaluate(() =>
          localStorage.getItem("majoken-save-rules-2.0.4"),
        ),
      ).toBe(before);
    });

    test("旧v2.0と旧v2.0.1の再開中にそれぞれのルールを表示する", async ({
      page,
    }) => {
      const old = [
        [
          "majoken-save-rules-2.0-final",
          serialize(createGame(setup, V20_RELEASE_RULES_VERSION)),
        ],
        [
          "majoken-save-rules-2.0.1",
          serialize(createGame(setup, V20_PLAYTEST_RULES_VERSION)),
        ],
      ];
      await page.addInitScript((saves) => {
        for (const [key, value] of saves) localStorage.setItem(key, value);
      }, old);
      await page.goto("/");
      const opener = page.getByRole("button", { name: title, exact: true });
      const guide = page.getByRole("dialog", { name: title, exact: true });
      for (const [version, trade] of [
        ["v2.0", "未回答の取引は失効"],
        ["v2.0.1", "未回答の取引を解決"],
      ] as const) {
        await page
          .getByRole("button", {
            name: "旧" + version + "の続きから",
            exact: true,
          })
          .click();
        await opener.click();
        await expect(
          guide.getByText("ルール " + version, { exact: true }),
        ).toBeVisible();
        await guide.getByText("1日の流れ", { exact: true }).click();
        await expect(guide.getByText(/全員が匿名で1票/)).toBeVisible();
        await expect(guide.getByText(new RegExp(trade))).toBeVisible();
        await expect(guide.getByText(/「次の日へ」で進みます/)).toBeVisible();
        await guide.getByText("基本システム", { exact: true }).click();
        await expect(guide.getByText(/持ち物を選んで1個奪う/)).toBeVisible();
        await guide
          .getByRole("button", { name: "閉じる", exact: true })
          .click();
        await expect(opener).toBeFocused();
      }
    });
  });
}
