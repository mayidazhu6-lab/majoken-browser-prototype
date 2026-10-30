import { test, expect, type Page } from "@playwright/test";
import { createGame, currentPlayer, dispatch } from "../src/domain/reducer";
import { simulationAction } from "../src/domain/simulation";
import { serialize } from "../src/domain/persistence";
import type { GameState } from "../src/domain/types";
const setup = {
  name: "アリア",
  seed: "witches-2026",
  magic: "barrier" as const,
  stats: { attack: 3, defense: 4, insight: 3 },
};
async function state(page: Page): Promise<GameState> {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem("majoken-save-v2")!).state,
  );
}
async function load(page: Page, s: GameState) {
  await page.locator('input[type="file"]').setInputFiles({
    name: "v021.json",
    mimeType: "application/json",
    buffer: Buffer.from(serialize(s)),
  });
  await expect(page.locator(".alert.error")).toHaveCount(0);
}
function findResults() {
  const found: Record<string, GameState> = {};
  for (const seed of ["moon-42", "result-0"]) {
    let s = createGame({ ...setup, seed });
    for (let n = 0; s.phase !== "ended" && n < 500; n++) {
      const c = s.combat;
      if (c?.kind === "secret" && c.done && !c.resultAcknowledged) {
        const key =
          c.winner === null ? "draw" : c.winner === 0 ? "win" : "loss";
        found[key] ??= structuredClone(s);
        if (Object.keys(found).length === 3) return found;
      }
      s = dispatch(s, simulationAction(s));
    }
  }
  return found;
}

test("取引ダイアログは中央で維持され、背景操作停止と返答後の手番復帰を明示", async ({
  page,
}) => {
  let s = createGame({
    ...setup,
    seed: "lab-77",
    stats: { attack: 4, defense: 3, insight: 3 },
  });
  s = dispatch(s, { type: "gather", player: 0 });
  s = dispatch(s, { type: "endTurn", player: 0 });
  expect(s.trades).toHaveLength(1);
  await page.goto("/");
  await load(page, s);
  const dialog = page.getByRole("dialog", { name: "取引への返答が必要です" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("手番進行と公開行動を停止");
  await expect(page.locator(".app-shell")).toHaveAttribute("inert");
  const before = await state(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(await state(page)).toEqual(before);
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(
    3,
  );
  await dialog.getByRole("button", { name: "拒否", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".app-shell")).not.toHaveAttribute("inert");
  await expect(page.locator(".persistent-turn")).toContainText("第2巡");
  await expect(page.locator(".persistent-turn")).toContainText(
    "現在の手番：アリア",
  );
  const result = await state(page);
  expect(currentPlayer(result)).toBe(0);
  expect(result.publicTurn.tradeAttempts["1:3:0"]).toBe(1);
});

for (const outcome of ["win", "loss", "draw"] as const)
  test(`秘匿決闘${outcome}：結果はOKまで閉じず、左右順と報酬順を維持`, async ({
    page,
  }) => {
    const s = findResults()[outcome];
    expect(s).toBeDefined();
    const c = s.combat!;
    await page.goto("/");
    await load(page, s);
    const dialog = page.getByRole("dialog", { name: "秘匿決闘の結果" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "OK", exact: true }),
    ).toBeInViewport();
    await expect(dialog.getByRole("heading", { level: 3 })).toHaveText(
      outcome === "win"
        ? "あなたの勝利"
        : outcome === "loss"
          ? "あなたの敗北"
          : "引き分け",
    );
    const headings = await dialog.locator("thead th").allTextContents();
    expect(headings).toEqual([
      "R",
      ...c.participants.map((id) => s.players[id].name),
    ]);
    const sides = await page
      .locator(".combat-panel .versus [data-player]")
      .evaluateAll((nodes) =>
        nodes.map((n) => Number(n.getAttribute("data-player"))),
      );
    expect(sides).toEqual(c.participants);
    for (const side of [0, 1]) {
      const cell = dialog.locator(
        `tbody tr:first-child td[data-side="${side}"]`,
      );
      await expect(cell).toContainText(`判定 ${c.rounds[0].values[side]}`);
      await expect(cell).toContainText(
        `被ダメージ ${c.rounds[0].damage[side]}`,
      );
    }
    await expect(page.locator(".event-panel")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await page.screenshot({
      path: `/tmp/majoken-v021-dialog-${outcome}.png`,
      fullPage: true,
    });
    await page.reload();
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    await expect(dialog).toBeVisible();
    expect(await state(page)).toEqual(s);
    await dialog.getByRole("button", { name: "OK", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    if (outcome === "win") {
      expect((await state(page)).phase).toBe("rewards");
      await page
        .getByRole("button", { name: "アイテムを1個強奪", exact: true })
        .click();
    }
    expect((await state(page)).combat).toBeUndefined();
    await page.screenshot({
      path: `/tmp/majoken-v021-${outcome}.png`,
      fullPage: true,
    });
  });

test("納品UIは第1巡の合算上限と取消回復を表示し、2個予約を拒否", async ({
  page,
}) => {
  let s = createGame({ ...setup, seed: "donation-12" });
  expect(s.event.id).toBe(1);
  await page.goto("/");
  await load(page, s);
  await page.getByRole("button", { name: "納品", exact: true }).click();
  const panel = page.locator(".actions-panel");
  await expect(panel.locator(".reservation-limit")).toContainText(
    "第1巡：1人1個",
  );
  const picker = panel.locator(".item-picker button");
  await picker.nth(0).click();
  await picker.nth(1).click();
  await expect(
    panel.getByRole("button", { name: "仮納品する", exact: true }),
  ).toBeDisabled();
  await picker.nth(1).click();
  await panel.getByRole("button", { name: "仮納品する", exact: true }).click();
  await expect(panel.locator(".reservation-limit")).toContainText(
    "予約済み1、残り0",
  );
  await panel
    .getByRole("button", { name: "自分の予約をすべて撤回", exact: true })
    .click();
  await expect(panel.locator(".reservation-limit")).toContainText(
    "予約済み0、残り1",
  );
  await picker.nth(0).click();
  await panel.getByRole("button", { name: "仮納品する", exact: true }).click();
  expect((await state(page)).players[0].ap).toBe(2);
  s = await state(page);
  for (
    let n = 0;
    !(
      s.phase === "public" &&
      s.publicTurn.round === 2 &&
      currentPlayer(s) === 0 &&
      !s.trades.length &&
      !s.combat &&
      !s.challenge
    ) && n < 100;
    n++
  )
    s = dispatch(s, simulationAction(s));
  await load(page, s);
  await expect(panel.locator(".reservation-limit")).toContainText(
    "個人上限なし",
  );
});

test("能力5→6のLv表示・次の閾値・レベル通知は一度だけ表示", async ({
  page,
}) => {
  const s = createGame({
    ...setup,
    seed: "level-ui-2",
    stats: { attack: 5, defense: 3, insight: 2 },
  });
  await page.goto("/");
  await load(page, s);
  await expect(page.locator('.level-guide [data-stat="attack"]')).toContainText(
    "次のLvまであと1（能力値6）",
  );
  await page
    .locator(".action-card")
    .filter({
      has: page.getByRole("heading", { name: "攻撃を研究", exact: true }),
    })
    .getByRole("button")
    .click();
  await expect(page.locator('.level-guide [data-stat="attack"]')).toContainText(
    "Lv2",
  );
  await expect(page.locator('.level-guide [data-stat="attack"]')).toContainText(
    "あと3（能力値9）",
  );
  await expect(
    page
      .locator(".journal .log-entry")
      .filter({ hasText: "アリアの攻撃がLv1→Lv2" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  await expect(
    page
      .locator(".journal .log-entry")
      .filter({ hasText: "アリアの攻撃がLv1→Lv2" }),
  ).toHaveCount(1);
});

test("日次HOは1/2→達成見込み→達成確定、フェーズに応じてイベントを非表示", async ({
  page,
}) => {
  let s = createGame({ ...setup, seed: "ho-ui-29" });
  expect(s.players[0].dailyGoal.id).toBe(9);
  await page.goto("/");
  await load(page, s);
  await expect(page.locator(".daily-ho-progress")).toHaveText(/未達成.*0\/2/);
  for (const target of [1, 2]) {
    const id = s.players[0].inventory[0].id;
    s = dispatch(s, {
      type: "trade",
      player: 0,
      target,
      offer: [id],
      request: {},
    });
    await load(page, s);
    await expect(page.locator(".daily-ho-progress")).toHaveText(
      target === 1 ? /未達成.*1\/2/ : /達成見込み.*2\/2/,
    );
  }
  for (let n = 0; s.phase !== "magic" && n < 100; n++)
    s = dispatch(s, simulationAction(s));
  await load(page, s);
  await expect(page.locator(".event-panel")).toHaveCount(0);
  for (let n = 0; s.phase !== "night" && n < 20; n++)
    s = dispatch(s, simulationAction(s));
  await load(page, s);
  await expect(page.locator(".event-panel")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "秘密の行動をひとつ。", exact: true }),
  ).toBeVisible();
  for (let n = 0; s.phase !== "dawn" && n < 100; n++)
    s = dispatch(s, simulationAction(s));
  expect(s.phase).toBe("dawn");
  await load(page, s);
  await expect(page.locator(".daily-ho-progress")).toHaveText(/達成確定.*2\/2/);
  await expect(page.locator(".results-summary")).toContainText(
    "日次HO達成！ FP+1",
  );
});
