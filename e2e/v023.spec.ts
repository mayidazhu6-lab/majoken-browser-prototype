import { test, expect, type Page } from "@playwright/test";
import { createGame, dispatch } from "../src/domain/reducer";
import { serialize } from "../src/domain/persistence";
import { simulationAction } from "../src/domain/simulation";
import type { GameState } from "../src/domain/types";
import { LABELS, STATS } from "../src/domain/config";
import { recipe } from "../src/domain/items";
import { selectItems } from "./helpers";
const setup = {
  name: "アリア",
  seed: "lab-77",
  magic: "barrier" as const,
  stats: { attack: 4, defense: 3, insight: 3 },
};
async function state(page: Page): Promise<GameState> {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem("majoken-save-v2")!).state,
  );
}
async function load(page: Page, s: GameState) {
  await page.locator("input[type=file]").setInputFiles({
    name: "v022.json",
    mimeType: "application/json",
    buffer: Buffer.from(serialize(s)),
  });
}
async function confirm(page: Page) {
  await page.getByRole("button", { name: "確認した", exact: true }).click();
}
async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "ゲーム開始 →", exact: true }).click();
  await page.getByLabel("乱数シード").fill(setup.seed);
  await page.getByRole("button", { name: /8日間の研究をはじめる/ }).click();
}
async function briefings(page: Page) {
  while (await page.locator(".briefing").isVisible()) await confirm(page);
}
async function presentation(page: Page) {
  for (let n = 0; n < 20; n++) {
    await page.waitForTimeout(20);
    if (await page.getByRole("dialog").isVisible()) return;
    if (await page.locator(".briefing, .action-result").isVisible()) {
      await confirm(page);
      continue;
    }
    for (const name of [
      "行動選択へ",
      "判定結果を見る",
      "次のラウンドへ",
      "戦闘終了へ",
    ]) {
      const button = page.getByRole("button", { name, exact: true });
      if (await button.isVisible()) {
        await button.click();
        break;
      }
    }
    if (
      (await page
        .getByRole("button", { name: "行動選択へ", exact: true })
        .isVisible()) ||
      (await page
        .getByRole("button", { name: "判定結果を見る", exact: true })
        .isVisible()) ||
      (await page
        .getByRole("button", { name: "次のラウンドへ", exact: true })
        .isVisible()) ||
      (await page
        .getByRole("button", { name: "戦闘終了へ", exact: true })
        .isVisible())
    )
      continue;
    if (await page.locator(".battle-intro").isVisible()) {
      await page
        .getByRole("button", { name: "戦闘結果を確認", exact: true })
        .click();
      continue;
    }
    const mock = page
      .locator(".combat-panel")
      .getByRole("button", { name: "確認した", exact: true });
    if (await mock.isVisible()) {
      await mock.click();
      continue;
    }
    return;
  }
}
test("タイトル→作成→卒業課題→今日の課題、確認中はゲームを進めない", async ({
  page,
}) => {
  await start(page);
  await expect(page.locator(".briefing")).toContainText("あなたの卒業課題");
  const initial = await state(page);
  await expect(page.locator(".actions-panel")).toHaveCount(0);
  await confirm(page);
  await expect(page.locator(".briefing")).toContainText("1日目の今日の課題");
  expect(await state(page)).toEqual(initial);
  await page.reload();
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  await expect(page.locator(".briefing")).toContainText("1日目の今日の課題");
  await confirm(page);
  await expect(page.locator(".action-menu")).toBeVisible();
  await expect(page.locator(".game-grid")).not.toContainText("HO");
});
test("行動画面のキャンセル・素材表示・結果確認・スクロール・共通メニューと他者秘匿", async ({
  page,
}) => {
  await start(page);
  await briefings(page);
  const before = await state(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByRole("button", { name: "研究", exact: true }).click();
  await expect(page.locator(".material-count")).toContainText(["必要1"]);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole("button", { name: "キャンセルして戻る" }).click();
  expect(await state(page)).toEqual(before);
  await page.getByRole("button", { name: "採集", exact: true }).click();
  await page.getByRole("button", { name: /採集 1AP/ }).click();
  await expect(page.locator(".action-result")).toBeVisible();
  expect((await state(page)).players[0].ap).toBe(before.players[0].ap - 1);
  await page.reload();
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  await expect(page.locator(".action-result")).toBeVisible();
  await confirm(page);
  await page.getByRole("button", { name: /🎒/ }).click();
  await expect(page.getByRole("dialog")).toContainText("素材");
  await page.getByRole("button", { name: "薬", exact: true }).click();
  await page
    .getByRole("button", { name: "閉じる", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: /📜/ }).click();
  await expect(page.getByRole("dialog")).toContainText("達成条件");
  await page.getByRole("button", { name: "卒業課題", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("達成条件");
  await page
    .getByRole("button", { name: "閉じる", exact: true })
    .last()
    .click();
  for (const card of await page.locator(".witch-card:not(.you)").all()) {
    await expect(card).toContainText("アイテム合計");
    await expect(card.locator(".fp")).toHaveCount(0);
    await expect(card).not.toContainText("AP");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: /🎒/ })).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/reports/v023-mobile.png",
    fullPage: true,
  });
});
test("戦闘開始→選択→公開→判定→5R、ためる表示・再開・元手番復帰", async ({
  page,
}) => {
  await page.goto("/");
  await load(
    page,
    createGame({
      ...setup,
      seed: "reward-5",
      stats: { attack: 2, defense: 2, insight: 6 },
    }),
  );
  await briefings(page);
  await page.getByRole("button", { name: "決闘", exact: true }).click();
  await page.getByRole("button", { name: "公開決闘 1AP", exact: true }).click();
  await page.getByRole("button", { name: "行動選択へ", exact: true }).click();
  await page
    .locator(".stance-options")
    .getByRole("button", { name: "ためる", exact: true })
    .click();
  await page.getByRole("button", { name: /手を確定/ }).click();
  await expect(
    page.getByRole("heading", { name: "双方の行動公開" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "判定結果を見る", exact: true })
    .click();
  await expect(page.locator(".combat-rounds")).toContainText(
    "次ラウンドの強化 +",
  );
  await page.screenshot({
    path: "docs/reports/v023-combat.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "第1ラウンドの判定結果" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "次のラウンドへ", exact: true })
    .click();
  await expect(page.locator(".battle-header")).toContainText("ためる +");
  await expect(
    page.locator(".stance-options button").filter({ hasText: "ためる" }),
  ).toBeDisabled();
  for (let r = 2; r <= 5; r++) {
    if (r === 5)
      await expect(
        page.locator(".stance-options button").filter({ hasText: "ためる" }),
      ).toBeDisabled();
    await page
      .locator(".stance-options")
      .getByRole("button", { name: "防御", exact: true })
      .click();
    await page.getByRole("button", { name: /手を確定/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("button", { name: "判定結果を見る", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: r === 5 ? "戦闘終了へ" : "次のラウンドへ",
        exact: true,
      })
      .click();
  }
  await expect(page.getByRole("dialog")).toContainText("最大5ラウンド");
  await confirm(page);
  expect((await state(page)).combat).toBeUndefined();
  expect((await state(page)).players[0].ap).toBe(1);
});
test("画面操作だけで8日目まで：課題確認、AI、納品、戦闘、夜、保存互換", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await confirm(page);
  let steps = 0;
  const days = new Set<number>();
  while (steps++ < 400) {
    await page.waitForTimeout(20);
    if (await page.locator(".briefing").isVisible()) {
      const s = await state(page);
      if (
        !(await page.locator(".briefing").textContent())?.includes(
          "あなたの卒業課題",
        )
      )
        days.add(s.day);
    }
    await presentation(page);
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
      case "eventAck":
      case "combatAck":
      case "publicOutcomeAck":
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "確認した", exact: true })
          .click();
        break;
      case "reward":
        await page
          .getByRole("button", { name: "アイテムを1個強奪", exact: true })
          .click();
        break;
      case "reserve":
        await page.getByRole("button", { name: "納品", exact: true }).click();
        await selectItems(page, s, a.items);
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
        await page.getByRole("button", { name: "採集", exact: true }).click();
        await page.getByRole("button", { name: /採集 1AP/ }).click();
        break;
      case "research":
        await page.getByRole("button", { name: "研究", exact: true }).click();
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
        await page.getByRole("button", { name: "受諾", exact: true }).click();
        break;
      case "unlock":
        await page
          .getByRole("button", { name: recipe(a.recipe)!.name, exact: true })
          .click();
        break;
      case "night":
        await page
          .locator(".night-options")
          .getByRole("button", { name: LABELS[a.choice.kind], exact: true })
          .click();
        if (a.choice.kind === "brew")
          for (const id of a.choice.recipes!) {
            await page.getByLabel("レシピ", { exact: true }).selectOption(id);
            await page
              .getByRole("button", { name: "作成予定に追加", exact: true })
              .click();
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
        throw Error(a.type);
    }
    await expect(page.locator(".alert.error")).toHaveCount(0);
  }
  expect(steps).toBeLessThan(400);
  expect([...days]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(errors).toEqual([]);
  await expect(page.locator(".final-results")).toBeVisible();
  await page.screenshot({
    path: "docs/reports/v023-ending.png",
    fullPage: true,
  });
});

test("夜の錬金キャンセルは素材・APを保ち、幻惑は固有魔法で先に確定する", async ({
  page,
}) => {
  let s = createGame({ ...setup, seed: "witches-2026", magic: "illusion" });
  for (let n = 0; s.phase !== "magic" && n < 200; n++)
    s = dispatch(s, simulationAction(s));
  expect(s.phase).toBe("magic");
  if (!s.event.acknowledged) s = dispatch(s, { type: "eventAck", player: 0 });
  await page.goto("/");
  await load(page, s);
  await expect(
    page.getByRole("heading", { name: "今夜、固有魔法を使いますか？" }),
  ).toBeVisible();
  const before = await state(page);
  const toggle = page.getByRole("checkbox", {
    name: "幻惑を使用する",
    exact: true,
  });
  await toggle.check();
  expect(await state(page)).toEqual(before);
  await page.getByRole("button", { name: /魔法を確定/ }).click();
  await confirm(page);
  expect((await state(page)).players[0].activeMagic).toBe(true);
  await page.locator(".progression button.primary").click();
  await page
    .locator(".night-options")
    .getByRole("button", { name: "錬金", exact: true })
    .click();
  const nightBefore = await state(page);
  const add = page.getByRole("button", { name: "作成予定に追加", exact: true });
  if (await add.isEnabled()) await add.click();
  await page
    .getByRole("button", { name: "キャンセルして戻る", exact: true })
    .click();
  expect(await state(page)).toEqual(nightBefore);
  await expect(page.locator(".night-options")).toBeVisible();
});

test("模擬戦も最終R公開・判定・確認まで専用画面を維持しJSONで再開する", async ({
  page,
}) => {
  let s = createGame(setup);
  for (let n = 0; s.event.id !== 4 && n < 200; n++)
    s = createGame({ ...setup, seed: `mock-v023-${n}` });
  expect(s.event.id).toBe(4);
  s = dispatch(s, { type: "duel", player: 0, target: 1, mock: true });
  await page.goto("/");
  await load(page, s);
  await briefings(page);
  await page.getByRole("button", { name: "行動選択へ", exact: true }).click();
  for (let r = 0; r < 5; r++) {
    await page
      .locator(".stance-options")
      .getByRole("button", { name: "防御", exact: true })
      .click();
    await page.getByRole("button", { name: /手を確定/ }).click();
    await expect(
      page.getByRole("heading", { name: "双方の行動公開", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "判定結果を見る", exact: true })
      .click();
    if (!(await state(page)).combat) break;
    await page
      .getByRole("button", { name: "次のラウンドへ", exact: true })
      .click();
  }
  const saved = await state(page);
  expect(saved.combat).toBeUndefined();
  await page.getByRole("button", { name: "戦闘終了へ", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON保存", exact: true }).click();
  const file = await download;
  await page.locator("input[type=file]").setInputFiles((await file.path())!);
  await expect(page.locator(".combat-panel")).toContainText("戦闘終了");
  expect(await state(page)).toEqual(saved);
  await page
    .locator(".combat-panel")
    .getByRole("button", { name: "確認した", exact: true })
    .click();
  await expect(page.locator(".combat-panel")).toHaveCount(0);
  await expect(page.locator(".action-menu")).toBeVisible();
});
