import { test, expect, type Page } from "@playwright/test";
import { createGame, dispatch, currentPlayer } from "../src/domain/reducer";
import { simulationAction } from "../src/domain/simulation";
import { serialize, deserialize } from "../src/domain/persistence";
import { collapseFixture } from "../tests/fixtures/endings";
import { settleScreens } from "./helpers";
import { publicResearchCost, NIGHT_RECIPES } from "../src/domain/night";
import { materialIds, available } from "../src/domain/items";
import { elementPotion, ELEMENT_POTIONS } from "../src/domain/elementCombat";
import type { GameState, Stat } from "../src/domain/types";
const key = "majoken-save-rules-2.1";
const setup = {
  name: "UI確認",
  seed: "night-13",
  magic: "barrier",
  stats: { attack: 3, defense: 3, insight: 3 },
} as const;
function fixture(kind: "combat" | number, version = "browser-2.1") {
  for (const seed of ["night-13", "qa-v21-0000", "collapse-end-0"]) {
    let s = createGame({ ...setup, seed }, version);
    for (let i = 0; i < 1500 && !s.result; i++) {
      if (typeof kind === "number" && s.phase === "public" && s.failed === kind)
        return s;
      if (
        kind === "combat" &&
        s.combat?.kind === "secret" &&
        s.combat.participants.includes(0) &&
        !s.combat.done &&
        !s.combat.elemental!.ready[s.combat.participants.indexOf(0)]
      )
        return s;
      const a =
        s.phase === "night" && !s.players[0].night
          ? {
              type: "night" as const,
              player: 0,
              choice: {
                kind:
                  s.players[0].lastRaid === s.day - 1
                    ? ("guard" as const)
                    : ("raid" as const),
                target: 2,
                recipes: [],
              },
            }
          : simulationAction(s);
      s = dispatch(s, a);
    }
  }
  throw Error("fixture unavailable " + kind);
}
async function load(page: Page, s: GameState, failAt = 0) {
  const raw = serialize(s);
  expect(deserialize(raw)).toEqual(s);
  await page.addInitScript(
    ({ raw, key, failAt }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, raw);
      if (failAt) {
        const put = Storage.prototype.setItem;
        let count = 0;
        (window as any).qaFail = true;
        Storage.prototype.setItem = function (k, v) {
          if (k === key && ++count >= failAt && (window as any).qaFail)
            throw Error("quota");
          put.call(this, k, v);
        };
      }
    },
    { raw, key, failAt },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "続きから", exact: true }).click();
}
const saved = (p: Page) => p.evaluate((k) => localStorage.getItem(k), key);
const confirm = (p: Page) =>
  p
    .locator(".combat-panel")
    .getByRole("button", { name: "属性と薬を確定", exact: true });
for (const width of [1440, 390]) {
  for (const failed of [0, 1, 2])
    test(`耐久は進行表示の下で課題より上 ${failed}失敗 ${width}px`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 960 });
      const s = fixture(failed);
      await load(page, s);
      const health = page.getByRole("region", { name: "研究所の残り耐久" });
      await expect(health).toHaveCount(1);
      await expect(health).toContainText(`${3 - failed} / 3`);
      const h = (await health.boundingBox())!,
        hud = (await page.locator(".turn-hud").boundingBox())!,
        goal = (await page.locator(".briefing").boundingBox())!;
      expect(h.y).toBeGreaterThanOrEqual(hud.y + hud.height);
      expect(Math.abs(h.x - hud.x)).toBeLessThan(2);
      expect(h.y + h.height).toBeLessThanOrEqual(goal.y);
      await health.getByText("失敗数と崩壊条件").click();
      await expect(health).toContainText(`累積失敗 ${failed} / 3`);
      await settleScreens(page);
      await expect(health).toHaveCount(1);
      expect(await saved(page)).toBe(serialize(s));
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`health-${failed}-${width}.png`),
        fullPage: true,
      });
      await page.reload();
      await page.getByRole("button", { name: "続きから", exact: true }).click();
      await expect(health).toContainText(`${3 - failed} / 3`);
    });
  test(`夜間は1確定で解決し履歴を残して次入力を待つ ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    let s = fixture("combat");
    await load(page, s);
    await page.getByRole("button", { name: "持ち込まずに進む" }).click();
    s = dispatch(s, { type: "loadout", player: 0, items: [] });
    expect(await saved(page)).toBe(serialize(s));
    for (let n = 0; n < 5 && !s.combat!.done; n++) {
      const element: Stat = (["defense", "insight", "attack"] as Stat[])[n % 3];
      await page
        .locator(".combat-panel")
        .getByRole("button", {
          name: { attack: "火", defense: "水", insight: "風" }[element],
          exact: true,
        })
        .click();
      expect(await saved(page)).toBe(serialize(s));
      s = dispatch(
        dispatch(s, { type: "elementRound", player: 0, element, bonus: false }),
        { type: "elementReply", player: 0 },
      );
      await confirm(page).click();
      await expect.poll(() => saved(page)).toBe(serialize(s));
      await expect(
        page.getByRole("button", { name: "ラウンド結果を見る", exact: true }),
      ).toHaveCount(0);
      if (!s.combat!.done) {
        await expect(page.locator(".combat-rounds")).toBeVisible();
        await expect(confirm(page)).toBeVisible();
      }
      const raw = await saved(page);
      await page.waitForTimeout(50);
      expect(await saved(page)).toBe(raw);
      if (n === 0) {
        await page.screenshot({
          path: info.outputPath(`night-${width}.png`),
          fullPage: true,
        });
        await page.reload();
        await page
          .getByRole("button", { name: "続きから", exact: true })
          .click();
        expect(await saved(page)).toBe(raw);
      }
    }
    expect(s.combat!.done).toBe(true);
    await expect(confirm(page)).toHaveCount(0);
    await expect(
      page
        .locator(".combat-panel")
        .getByRole("button", { name: "確認した", exact: true }),
    ).toBeVisible();
    expect(deserialize((await saved(page))!)).toEqual(s);
  });
  for (const failAt of [1, 2])
    test(`入力/解決保存失敗は同じ2操作を一度だけ再保存 ${failAt} ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      let s = fixture("combat");
      s = dispatch(s, { type: "loadout", player: 0, items: [] });
      const locked = dispatch(s, {
          type: "elementRound",
          player: 0,
          element: "defense",
          bonus: false,
        }),
        out = dispatch(locked, { type: "elementReply", player: 0 });
      await load(page, s, failAt);
      await page
        .locator(".combat-panel")
        .getByRole("button", { name: "水", exact: true })
        .click();
      await confirm(page).click();
      await expect(
        page.getByRole("button", { name: "保存を再試行", exact: true }),
      ).toBeVisible();
      expect(await saved(page)).toBe(serialize(failAt === 1 ? s : locked));
      await page.evaluate(() => ((window as any).qaFail = false));
      await page
        .getByRole("button", { name: "保存を再試行", exact: true })
        .click();
      await expect.poll(() => saved(page)).toBe(serialize(out));
      await page.reload();
      await page.getByRole("button", { name: "続きから", exact: true }).click();
      expect(await saved(page)).toBe(serialize(out));
    });
  test(`旧入力確定待ちを再開しても解決は一度だけ ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    let s = fixture("combat");
    s = dispatch(s, { type: "loadout", player: 0, items: [] });
    s = dispatch(s, {
      type: "elementRound",
      player: 0,
      element: "defense",
      bonus: false,
    });
    const out = dispatch(s, { type: "elementReply", player: 0 });
    await load(page, s);
    await expect.poll(() => saved(page)).toBe(serialize(out));
  });
  test(`崩壊時は従来どおり耐久カードを追加しない ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await load(page, collapseFixture());
    await expect(page.locator(".institute-health")).toHaveCount(0);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "確認した", exact: true })
      .click();
    await expect(page.locator(".final-results")).toContainText("研究所は崩壊");
    await expect(page.locator(".institute-health")).toHaveCount(0);
  });
}

// Explore legal round inputs against the unchanged engine; these are test plans,
// never AI hints or gameplay code. All mounted saves still replay strictly.
let plans: Map<string, { start: GameState; elements: Stat[]; end: GameState }>;
function endingPlans() {
  if (plans) return plans;
  plans = new Map();
  const start = dispatch(fixture("combat"), {
    type: "loadout",
    player: 0,
    items: [],
  });
  function visit(s: GameState, elements: Stat[]) {
    if (s.combat!.done) {
      const winner = s.combat!.winner,
        key = winner === null ? "draw" : winner === 0 ? "win" : "loss";
      if (!plans.has(key)) plans.set(key, { start, elements, end: s });
      if (s.combat!.elemental!.rounds.length < 5 && !plans.has("ko"))
        plans.set("ko", { start, elements, end: s });
      return;
    }
    for (const element of ["attack", "defense", "insight"] as Stat[]) {
      if (plans.size === 4) return;
      visit(
        dispatch(
          dispatch(s, {
            type: "elementRound",
            player: 0,
            element,
            bonus: false,
          }),
          { type: "elementReply", player: 0 },
        ),
        [...elements, element],
      );
    }
  }
  visit(start, []);
  return plans;
}
for (const outcome of ["win", "loss", "draw", "ko"])
  test(`夜間の${outcome}は確定後に次入力を出さず最終確認を維持`, async ({
    page,
  }) => {
    const plan = endingPlans().get(outcome);
    expect(plan, `legal ${outcome} plan`).toBeTruthy();
    await load(page, plan!.start);
    for (const element of plan!.elements) {
      await page
        .locator(".combat-panel")
        .getByRole("button", {
          name: { attack: "火", defense: "水", insight: "風" }[element],
          exact: true,
        })
        .click();
      await confirm(page).click();
    }
    await expect.poll(() => saved(page)).toBe(serialize(plan!.end));
    await expect(confirm(page)).toHaveCount(0);
    await expect(
      page
        .locator(".combat-panel")
        .getByRole("button", { name: "確認した", exact: true }),
    ).toBeVisible();
  });

test("夜間の使用薬も確定入力から一度だけ解決する", async ({ page }) => {
  let start: GameState | undefined;
  for (let seed = 0; seed < 12 && !start; seed++) {
    let s = createGame(
      {
        ...setup,
        seed: `ui-potion-${seed}`,
        stats: { attack: 2, defense: 2, insight: 5 },
      },
      "browser-2.1",
    );
    for (let i = 0; i < 1500 && !s.result; i++) {
      if (
        s.combat?.kind === "secret" &&
        s.combat.participants.includes(0) &&
        !s.combat.done &&
        !s.combat.elemental!.ready[s.combat.participants.indexOf(0)] &&
        available(s.players[0]).some(
          (p) => elementPotion(p.kind) && (p.usableDay ?? 0) <= s.day,
        )
      ) {
        start = s;
        break;
      }
      let a = simulationAction(s);
      const p = s.players[0];
      if (
        s.phase === "public" &&
        currentPlayer(s) === 0 &&
        ["gather", "research"].includes(a.type)
      ) {
        for (const material of [undefined, "water", "sand"]) {
          const cost = publicResearchCost(p, "insight", material);
          if (cost && materialIds(p, cost)) {
            a = {
              type: "research",
              player: 0,
              stat: "insight",
              ...(material ? { material } : {}),
            };
            break;
          }
        }
      }
      if (s.phase === "night" && !p.night) {
        const r = NIGHT_RECIPES.find(
          (r) =>
            r.level === 2 &&
            p.recipes.includes(r.id) &&
            materialIds(p, r.materials),
        );
        a = {
          type: "night",
          player: 0,
          choice: {
            kind: p.lastRaid === s.day - 1 ? "guard" : "raid",
            target: 2,
            recipes: r ? [r.id] : [],
          },
        };
      }
      s = dispatch(s, a);
    }
  }
  expect(start, "legal brewed-potion night fixture").toBeTruthy();
  let s = start!;
  const item = available(s.players[0]).find(
    (p) => elementPotion(p.kind) && (p.usableDay ?? 0) <= s.day,
  )!;
  const element = Object.entries(ELEMENT_POTIONS).find(
    ([, v]) => v.id === item.kind,
  )![0] as Stat;
  await load(page, s);
  const panel = page.locator(".combat-panel");
  await panel
    .getByRole("checkbox", {
      name: elementPotion(item.kind)!.name,
      exact: true,
    })
    .check();
  await panel
    .getByRole("button", { name: "持ち込みを確定", exact: true })
    .click();
  s = dispatch(s, { type: "loadout", player: 0, items: [item.id] });
  await panel
    .getByRole("button", {
      name: { attack: "火", defense: "水", insight: "風" }[element],
      exact: true,
    })
    .click();
  await panel.getByLabel("このラウンドの薬").selectOption(String(item.id));
  const expected = dispatch(
    dispatch(s, {
      type: "elementRound",
      player: 0,
      element,
      potion: item.id,
      bonus: false,
    }),
    { type: "elementReply", player: 0 },
  );
  await confirm(page).click();
  await expect.poll(() => saved(page)).toBe(serialize(expected));
  expect(deserialize((await saved(page))!)).toEqual(expected);
});
