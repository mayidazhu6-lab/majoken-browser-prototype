import { test, expect, type Page } from "@playwright/test";
import { createGame, dispatch, currentPlayer } from "../src/domain/reducer";
import { serialize } from "../src/domain/persistence";
import { STATS, MATERIALS, V20_LABELS, LABELS } from "../src/domain/config";
import type { GameState } from "../src/domain/types";
import { settleScreens } from "./helpers";
const baseline = !!process.env.LAYOUT_BEFORE;
const key = "majoken-save-rules-2.0.4";
function fixture() {
  for (let i = 0; i < 3000; i++) {
    const s = createGame(
      {
        name: "アリア",
        seed: `layout-${i}`,
        magic: "barrier",
        stats: { attack: 3, defense: 3, insight: 3 },
      },
      "browser-2.0.4",
    );
    if (s.event.id !== 5 || currentPlayer(s) !== 0) continue;
    const enabled = STATS.map((stat) => {
      try {
        dispatch(s, { type: "research", player: 0, stat });
        return true;
      } catch {
        return false;
      }
    });
    if (enabled.some(Boolean) && !enabled.every(Boolean)) return s;
  }
  throw Error("No legal layout fixture");
}
async function load(page: Page, s: GameState, graduation = false) {
  await page.goto("/");
  await page.evaluate(
    ({ s, json, key, graduation }) => {
      localStorage.clear();
      localStorage.setItem(key, json);
      localStorage.setItem(
        "majoken-ui-rules-2.0.4",
        JSON.stringify({
          version: 1,
          key: JSON.stringify([s.setup, s.actions]),
          day: graduation ? 0 : s.day,
          graduation,
          actionResult: [],
          battleStep: "intro",
        }),
      );
    },
    { s, json: serialize(s), key, graduation },
  );
  await page.reload();
  await page.getByRole("button", { name: "続きから", exact: true }).click();
}
for (const width of [1440, 390, 320])
  test(`layout, goal and single delivery entry ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 740 });
    const s = fixture();
    const saved = () => page.evaluate((k) => localStorage.getItem(k), key);
    async function shot(name: string) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: info.outputPath(`${name}-${width}.png`),
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await load(page, s, true);
    await shot("graduation");
    if (!baseline) {
      const card = await page.locator(".graduation-briefing").boundingBox();
      const hud = await page.locator(".turn-hud").boundingBox();
      expect(card!.y - hud!.y - hud!.height).toBeLessThan(32);
      await expect(
        page.locator(".graduation-briefing .task-name"),
      ).toBeVisible();
    }
    const initial = await saved();
    await page
      .locator(".briefing")
      .getByRole("button", { name: "確認した", exact: true })
      .click();
    await page
      .locator(".briefing")
      .getByRole("button", { name: "確認した", exact: true })
      .click();
    expect(await saved()).toBe(initial);
    await shot("public");
    if (!baseline) {
      await expect(
        page
          .getByRole("navigation", { name: "公開行動" })
          .getByRole("button", { name: /納品/ }),
      ).toHaveCount(0);
      await expect(
        page
          .locator(".event-preview")
          .getByRole("button", { name: "納品へ（0AP）", exact: true }),
      ).toBeVisible();
      const grid = await page.locator(".public-home").boundingBox(),
        hud = await page.locator(".turn-hud").boundingBox();
      if (width === 1440) {
        expect(grid!.y - hud!.y - hud!.height).toBeLessThan(32);
        const health = await page.locator(".institute-health").boundingBox(),
          actions = await page.locator(".center-column").boundingBox();
        expect(Math.abs(health!.y - actions!.y)).toBeLessThan(20);
      }
    }
    await page
      .getByRole("button", { name: "研究（1AP）", exact: true })
      .click();
    await shot("research");
    if (!baseline) {
      await expect(page.locator(".research-execute.primary")).toHaveCount(1);
      await expect(
        page.locator('.research-execute:disabled svg[data-symbol="lock"]'),
      ).toHaveCount(2);
      await expect(page.locator(".research-execute.primary")).toHaveText(
        "研究する（1AP）",
      );
    }
    await page.getByRole("button", { name: "キャンセルして戻る" }).click();
    await page
      .getByRole("button", {
        name: baseline ? "納品（0AP）" : "納品へ（0AP）",
        exact: true,
      })
      .click();
    const item = s.players[0].inventory.find((i) =>
      MATERIALS.includes(i.kind),
    )!;
    await page
      .getByLabel(`${V20_LABELS[item.kind] ?? LABELS[item.kind]}の数量`, {
        exact: true,
      })
      .fill("1");
    await page
      .getByRole("button", { name: "仮納品する（0AP）", exact: true })
      .click();
    await settleScreens(page);
    expect(JSON.parse((await saved())!).state).toEqual(
      JSON.parse(
        serialize(
          dispatch(s, {
            type: "reserve",
            player: 0,
            items: [item.id],
            stats: {},
          }),
        ),
      ).state,
    );
    await page.reload();
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    await settleScreens(page);
    await page
      .getByRole("button", {
        name: baseline ? "納品（0AP）" : "納品へ（0AP）",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "自分の予約をすべて撤回（0AP）" }),
    ).toBeEnabled();
  });

for (const width of [1440, 390, 320])
  test(`long graduation goal remains scrollable and confirmable ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 1440 ? 700 : 568 });
    await page.goto("/");
    await page.evaluate(async () => {
      const { createApp } = await new Function(
        "return import('/node_modules/.vite/deps/vue.js')",
      )();
      const { default: Briefing } = await new Function(
        "return import('/src/components/TaskBriefing.vue')",
      )();
      const host = document.createElement("main");
      host.id = "long-graduation";
      host.style.padding = "16px";
      document.body.replaceChildren(host);
      createApp(Briefing, {
        graduation: true,
        day: 1,
        name: "長い卒業課題の表示確認",
        condition:
          "複数の対象や品物を確認し、指定された条件を達成する。".repeat(12),
        onConfirm: () => {
          host.dataset.confirmed = "true";
        },
      }).mount(host);
    });
    const card = page.locator("#long-graduation .briefing");
    await expect(card.locator(".task-condition")).toHaveCSS(
      "overflow",
      "visible",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const button = card.getByRole("button", { name: "確認した", exact: true });
    await button.focus();
    await expect(button).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("#long-graduation")).toHaveAttribute(
      "data-confirmed",
      "true",
    );
    await card.screenshot({
      path: info.outputPath(`long-graduation-${width}.png`),
    });
  });
