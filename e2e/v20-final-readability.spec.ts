import { expect, test, type Page } from "@playwright/test";
import { createGame, dispatch, currentPlayer } from "../src/domain/reducer";
import { serialize } from "../src/domain/persistence";
import { simulationAction } from "../src/domain/simulation";
import type { GameState } from "../src/domain/types";
import { midpointMorningStates } from "../tests/fixtures/midpointMorning";
import { settleScreens } from "./helpers";
const key = "majoken-save-rules-2.0.4";
const before = !!process.env.FINAL_BEFORE;
function fixtures() {
  let success: GameState | undefined,
    failure: GameState | undefined,
    research: GameState | undefined,
    noAP: GameState | undefined;
  for (
    let seed = 0;
    seed < 30 && (!success || !failure || !research || !noAP);
    seed++
  ) {
    let s = createGame(
      {
        name: "アリア",
        seed: `final-ui-${seed}`,
        magic: "barrier",
        stats: { attack: 3, defense: 3, insight: 3 },
      },
      "browser-2.0.4",
    );
    for (let n = 0; n < 400 && !s.result; n++) {
      if (
        s.phase === "public" &&
        currentPlayer(s) === 0 &&
        !s.publicTurn.acted &&
        !research
      )
        research = s;
      if (s.event.resolved && !s.event.acknowledged) {
        if (s.event.success) success ??= s;
        else failure ??= s;
      }
      if (
        s.phase === "public" &&
        currentPlayer(s) === 0 &&
        s.players[0].ap === 0 &&
        !s.event.resolved &&
        !s.combat &&
        !s.challenge
      )
        noAP ??= s;
      if (success && failure && research && noAP) break;
      s = dispatch(s, simulationAction(s));
    }
  }
  if (!success || !failure || !research || !noAP)
    throw Error("Missing legal fixtures");
  return { success, failure, research, noAP };
}
async function load(page: Page, s: GameState) {
  await page.goto("/");
  await page.evaluate(
    ({ key, json, ui }) => {
      localStorage.clear();
      localStorage.setItem(key, json);
      localStorage.setItem("majoken-ui-rules-2.0.4", JSON.stringify(ui));
    },
    {
      key,
      json: serialize(s),
      ui: {
        version: 1,
        key: JSON.stringify([s.setup, s.actions]),
        day: s.day,
        graduation: false,
        actionResult: [],
        battleStep: "intro",
      },
    },
  );
  await page.reload();
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  await settleScreens(page);
}
async function contrast(el: ReturnType<Page["locator"]>) {
  return el.evaluate((el) => {
    const st = getComputedStyle(el);
    let bg = st.backgroundColor,
      p = el.parentElement;
    while (bg === "rgba(0, 0, 0, 0)" && p) {
      bg = getComputedStyle(p).backgroundColor;
      p = p.parentElement;
    }
    function lum(s: string) {
      const c = s
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
      return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    }
    const a = lum(st.color),
      b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}
for (const width of [1440, 390, 320])
  test(`final readability ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    async function shot(name: string) {
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
    await page.goto("/");
    await page.getByRole("button", { name: /ゲーム開始/ }).click();
    const magic = page.locator(".magic-options button").first();
    await magic.focus();
    await page.keyboard.press("Enter");
    await shot("magic");
    if (!before) {
      await expect(magic).toHaveAttribute("aria-pressed", "true");
      expect(await contrast(magic.locator("small"))).toBeGreaterThanOrEqual(
        4.5,
      );
      await expect(magic).toBeFocused();
    }
    const f = fixtures();
    for (const [name, s] of [
      ["event-success", f.success],
      ["event-failure", f.failure],
    ] as const) {
      await load(page, s);
      const dialog = page.getByRole("dialog", {
        name: "共通イベントの結果",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await shot(name);
      if (!before) {
        await expect(page.locator("html")).toHaveAttribute("data-theme", "day");
        await page.reload();
        await page
          .getByRole("button", { name: "続きから", exact: true })
          .click();
        await expect(page.locator("html")).toHaveAttribute("data-theme", "day");
      }
      expect(
        JSON.parse((await page.evaluate((k) => localStorage.getItem(k), key))!)
          .state,
      ).toEqual(JSON.parse(serialize(s)).state);
      await dialog
        .getByRole("button", { name: "確認した", exact: true })
        .click();
      if (!before) {
        await expect(page.locator("html")).toHaveAttribute(
          "data-theme",
          "night",
        );
        expect(
          JSON.parse(
            (await page.evaluate((k) => localStorage.getItem(k), key))!,
          ).state,
        ).toEqual(
          JSON.parse(serialize(dispatch(s, { type: "eventAck", player: 0 })))
            .state,
        );
      }
    }
    const { day4Ho } = midpointMorningStates();
    await load(page, day4Ho);
    if (!before)
      await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
    await page.getByRole("button", { name: /課題を判定して夜明けへ/ }).click();
    await shot("dawn");
    if (!before) {
      await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
      await page.reload();
      await page.getByRole("button", { name: "続きから", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
    }
    await page.getByRole("button", { name: /次の日へ/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "day");
    await load(page, f.research);
    await page
      .getByRole("button", { name: "研究（1AP）", exact: true })
      .click();
    await shot("research");
    if (!before) {
      for (const b of await page.locator(".research-card button").all())
        expect(await contrast(b)).toBeGreaterThanOrEqual(4.5);
    }
    if (!before) {
      const savedBefore = await page.evaluate(
        (k) => localStorage.getItem(k),
        key,
      );
      const unavailable = page
        .locator(".research-card")
        .filter({ has: page.locator("button:disabled") })
        .first();
      await expect(unavailable.locator(".research-unavailable")).toContainText(
        "研究素材不足",
      );
      await unavailable
        .locator("button")
        .evaluate((b: HTMLButtonElement) => b.click());
      expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(
        savedBefore,
      );
      const available = page
        .locator(".research-card")
        .filter({ has: page.locator("button:enabled") })
        .first();
      const index = await available.evaluate((el) =>
        Array.from(
          el.parentElement!.querySelectorAll(".research-card"),
        ).indexOf(el),
      );
      const stat = (["attack", "defense", "insight"] as const)[index];
      await available.locator("button").focus();
      await page.keyboard.press("Enter");
      expect(
        JSON.parse((await page.evaluate((k) => localStorage.getItem(k), key))!)
          .state,
      ).toEqual(
        JSON.parse(
          serialize(
            dispatch(f.research, { type: "research", player: 0, stat }),
          ),
        ).state,
      );
      await load(page, f.noAP);
      await page.getByRole("button", { name: /^研究（1AP）/ }).click();
      await expect(page.locator(".research-unavailable").first()).toContainText(
        /AP|通常行動/,
      );
      for (const button of await page.locator(".research-card button").all()) {
        await expect(button).toBeDisabled();
        expect(await contrast(button)).toBeGreaterThanOrEqual(4.5);
      }
      await shot("research-no-ap");
    }
    // Render the reusable health component in all four display states, without changing game state.
    await page.evaluate(async () => {
      const { createApp } = await new Function(
        "return import('/node_modules/.vite/deps/vue.js')",
      )();
      const { default: Health } = await new Function(
        "return import('/src/components/InstituteHealth.vue')",
      )();
      const host = document.createElement("div");
      host.id = "health-examples";
      host.style.cssText = "padding:12px;display:grid;gap:12px";
      document.body.prepend(host);
      for (let failed = 0; failed <= 3; failed++) {
        const node = document.createElement("div");
        host.append(node);
        createApp(Health, { failed }).mount(node);
      }
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page
      .locator("#health-examples")
      .screenshot({ path: info.outputPath(`health-${width}.png`) });
    if (!before) {
      const health = page.locator("#health-examples .institute-health");
      for (let i = 0; i < 4; i++) {
        await expect(health.nth(i).locator(".health-gem")).toHaveCount(3);
        await expect(health.nth(i).locator(".health-gem.filled")).toHaveCount(
          3 - i,
        );
        await expect(health.nth(i)).toContainText(`${3 - i} / 3`);
        await expect(health.nth(i).locator("meter")).toHaveCount(0);
      }
    }
  });

test("shared disabled and selected labels keep contrast in both palettes", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const host = document.createElement("section");
    host.id = "contrast-examples";
    host.className = "panel";
    host.innerHTML =
      '<button disabled>無効な操作 <small>1AP</small></button><button class="primary" disabled>無効な主操作</button><button class="chosen" aria-pressed="true"><small>選択済み</small></button>';
    document.body.append(host);
  });
  for (const theme of ["day", "night"]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    for (const label of await page
      .locator("#contrast-examples button, #contrast-examples small")
      .all())
      expect(await contrast(label)).toBeGreaterThanOrEqual(4.5);
  }
});
