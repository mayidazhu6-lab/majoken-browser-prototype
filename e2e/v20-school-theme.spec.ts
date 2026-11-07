import { expect, test, type Page } from "@playwright/test";
import { createGame, currentPlayer, dispatch } from "../src/domain/reducer";
import { simulationAction } from "../src/domain/simulation";
import { serialize, replay } from "../src/domain/persistence";
import { MATERIALS, STATS } from "../src/domain/config";
import { NIGHT_RECIPES } from "../src/domain/night";
import type { Action, GameState, Setup } from "../src/domain/types";
import fixture from "../tests/fixtures/v203-late-duel.json" with { type: "json" };
import { settleScreens } from "./helpers";
const key = "majoken-save-rules-2.0.4";
function dayState() {
  for (let i = 0; i < 1000; i++) {
    const s = createGame(
      {
        name: "アリア",
        seed: `stage1-${i}`,
        magic: "barrier",
        stats: { attack: 3, defense: 3, insight: 3 },
      },
      "browser-2.0.4",
    );
    if (s.event.id === 5 && currentPlayer(s) === 0) return s;
  }
  throw Error("No daylight fixture");
}
function nightState() {
  let s = createGame(
    {
      name: "アリア",
      seed: "staged-night-0",
      magic: "barrier",
      stats: { attack: 3, defense: 3, insight: 3 },
    },
    "browser-2.0.4",
  );
  for (let n = 0; n < 100 && !s.result && s.phase !== "night"; n++)
    s = dispatch(s, simulationAction(s));
  if (s.phase !== "night") throw Error("No night fixture");
  return s;
}
async function load(page: Page, state: GameState) {
  await page.addInitScript(
    ({ key, json }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, json);
    },
    { key, json: serialize(state) },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  await settleScreens(page);
}
async function saved(page: Page) {
  return page.evaluate((key) => localStorage.getItem(key), key);
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function assertTextContrast(page: Page, selector: string) {
  const ratio = await page
    .locator(selector)
    .first()
    .evaluate((el) => {
      function rgb(s: string) {
        return s
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);
      }
      function lum(s: string) {
        const c = rgb(s).map((x) => {
          x /= 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
        return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
      }
      const styles = getComputedStyle(el);
      let bg = styles.backgroundColor;
      let parent = el.parentElement;
      while ((bg === "rgba(0, 0, 0, 0)" || bg === "transparent") && parent) {
        bg = getComputedStyle(parent).backgroundColor;
        parent = parent.parentElement;
      }
      const a = lum(styles.color),
        b = lum(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
  expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
}
for (const width of [1440, 390]) {
  test(`school day/night, icons, teleported dialog and resume ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await load(page, dayState());
    await expect(page.locator("html")).toHaveAttribute("data-theme", "day");
    const before = await saved(page);
    await expect(page.locator(".actions-panel")).toHaveCSS(
      "background-color",
      "rgb(255, 249, 239)",
    );
    await noOverflow(page);
    await assertTextContrast(page, ".actions-panel");
    await assertTextContrast(page, ".event-preview .event-status");
    await page.screenshot({
      path: testInfo.outputPath(`day-${width}.png`),
      fullPage: false,
    });
    // Theme styling is layout-neutral even for the same state.
    const choices = page.getByRole("navigation", { name: "公開行動" });
    const dimensions = await choices.boundingBox();
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "night"),
    );
    expect(await choices.boundingBox()).toEqual(dimensions);
    await page.evaluate(() => (document.documentElement.dataset.theme = "day"));
    await page
      .getByRole("button", { name: "採集（1AP）", exact: true })
      .click();
    await page.getByText("採集できる素材を見る", { exact: true }).click();
    const roster = page.locator(".material-roster");
    for (const kind of MATERIALS) {
      const icon = roster.locator(`svg[data-icon="${kind}"]`);
      await expect(icon).toHaveAttribute("aria-hidden", "true");
      expect(
        await icon.evaluate((el) => (el as SVGGraphicsElement).getBBox().width),
      ).toBeGreaterThan(0);
    }
    await roster.screenshot({
      path: testInfo.outputPath(`materials-${width}.png`),
    });
    await page.getByRole("button", { name: "キャンセルして戻る" }).click();
    await page
      .getByRole("button", { name: "魔女間取引（0AP）", exact: true })
      .click();
    await page
      .getByText("自分が渡す数・相手から受け取る数を入力", { exact: true })
      .click();
    for (const r of NIGHT_RECIPES)
      await expect(
        page.locator(`.trade-row svg[data-icon="${r.id}"]`),
      ).toHaveAttribute("data-mark", /.+/);
    expect(await saved(page)).toBe(before);
    await page.getByRole("button", { name: "キャンセルして戻る" }).click();
    await page
      .getByRole("navigation", { name: "共通メニュー" })
      .getByRole("button", { name: "持ち物", exact: true })
      .click();
    let dialog = page.getByRole("dialog", { name: "持ち物", exact: true });
    await expect(dialog).toHaveCSS("background-color", "rgb(255, 249, 239)");
    await assertTextContrast(page, ".blocking-dialog");
    await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
    await page.getByLabel("JSON読込", { exact: true }).setInputFiles({
      name: "night.json",
      mimeType: "application/json",
      buffer: Buffer.from(serialize(nightState())),
    });
    await settleScreens(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
    const nightSaved = await saved(page);
    expect(JSON.parse(nightSaved!).state).toEqual(
      JSON.parse(serialize(nightState())).state,
    );
    await expect(page.locator(".night-panel")).toHaveCSS(
      "background-color",
      "rgb(48, 40, 63)",
    );
    await assertTextContrast(page, ".night-panel");
    await assertTextContrast(page, ".common-menu button");
    await assertTextContrast(page, ".night-panel .primary");
    await assertTextContrast(page, ".night-panel button.active");
    const active = page.locator(".night-panel button.active");
    await expect(active.locator(".game-icon")).toHaveCSS(
      "color",
      await active.evaluate((el) => getComputedStyle(el).color),
    );
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`night-${width}.png`),
      fullPage: false,
    });
    const effects = page.locator(".night-panel details").filter({
      has: page.locator("summary", { hasText: "すべての薬の効果" }),
    });
    await effects.locator("summary").click();
    await effects.evaluate((el) => {
      const hud = document.querySelector(".turn-hud")!.getBoundingClientRect();
      window.scrollTo(
        0,
        window.scrollY + el.getBoundingClientRect().top - hud.height - 12,
      );
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.screenshot({
      path: testInfo.outputPath(`potions-context-${width}.png`),
      fullPage: false,
    });
    await effects.screenshot({
      path: testInfo.outputPath(`potions-${width}.png`),
    });
    await effects.locator("summary").click();

    await page
      .getByRole("navigation", { name: "共通メニュー" })
      .getByRole("button", { name: "持ち物", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "持ち物", exact: true });
    await expect(dialog).toHaveCSS("background-color", "rgb(48, 40, 63)");
    await assertTextContrast(page, ".blocking-dialog");
    await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
    expect(await saved(page)).toBe(nightSaved);
    await page.reload();
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    await settleScreens(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
    expect(await saved(page)).toBe(nightSaved);
  });
  test(`school affinity triangle selection and combat input ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await load(
      page,
      replay(
        fixture.setup as Setup,
        fixture.actionsBeforeWin as Action[],
        "browser-2.0.4",
      ),
    );
    const before = await saved(page);
    const chart = page.locator(".affinity-triangle");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "day");
    for (const [from, to] of [
      ["attack", "insight"],
      ["insight", "defense"],
      ["defense", "attack"],
    ])
      await expect(chart.locator(`path[data-from="${from}"]`)).toHaveAttribute(
        "data-to",
        to,
      );
    for (const stat of STATS) {
      const name = { attack: "火", defense: "水", insight: "風" }[stat];
      await page.getByRole("button", { name, exact: true }).click();
      await expect(chart.locator(`[data-element="${stat}"]`)).toHaveAttribute(
        "data-selected",
        "true",
      );
      expect(await saved(page)).toBe(before);
    }
    for (const icon of await chart.locator(".diagram-icon").all()) {
      const bounds = await icon.boundingBox();
      expect(bounds!.width).toBeLessThanOrEqual(30);
      expect(bounds!.height).toBeLessThanOrEqual(30);
    }
    await page.evaluate(() => {
      const card = document.querySelector(".combat-affinity")!;
      const hud = document.querySelector(".turn-hud")!.getBoundingClientRect();
      window.scrollTo(
        0,
        window.scrollY + card.getBoundingClientRect().top - hud.height - 12,
      );
    });
    const figure = await chart.boundingBox();
    const hud = await page.locator(".turn-hud").boundingBox();
    expect(figure!.y).toBeGreaterThanOrEqual(hud!.y + hud!.height);
    await page
      .locator(".combat-affinity")
      .screenshot({ path: testInfo.outputPath(`affinity-${width}.png`) });
    await noOverflow(page);
    await page.getByRole("button", { name: "水", exact: true }).click();
    await page
      .getByRole("button", { name: "属性と薬を確定", exact: true })
      .click();
    expect(JSON.parse((await saved(page))!).state.combat.done).toBe(true);
  });
}
// Exercise the retained legacy presentation branch without widening supported save versions.
test("legacy combat explanation and icons remain distinct from the elemental diagram", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { createApp } = await new Function(
      "return import('/node_modules/.vite/deps/vue.js')",
    )();
    const { default: CombatAffinity } = await new Function(
      "return import('/src/components/CombatAffinity.vue')",
    )();
    const { default: GameIcon } = await new Function(
      "return import('/src/components/GameIcon.vue')",
    )();
    const host = document.createElement("div");
    host.id = "legacy-presentation";
    document.body.append(host);
    createApp(CombatAffinity, { elemental: false }).mount(host);
    const icon = document.createElement("div");
    host.append(icon);
    createApp(GameIcon, { kind: "attack", legacy: true, label: "攻撃" }).mount(
      icon,
    );
  });
  const legacy = page.locator("#legacy-presentation");
  await expect(legacy).toContainText("手の関係（旧ルール）");
  await expect(legacy).toContainText("ためる");
  await expect(legacy).toContainText("幻惑");
  await expect(legacy.locator(".affinity-triangle")).toHaveCount(0);
  await expect(legacy.locator("svg[data-symbol='sword']")).toBeVisible();
});
