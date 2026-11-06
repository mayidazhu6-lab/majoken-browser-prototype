import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { settleScreens } from "./helpers";
import type { Action } from "../src/domain/types";

const key = "majoken-save-rules-2.0-final";
const [run] = JSON.parse(
  readFileSync("tests/fixtures/v20-runs.json", "utf8"),
) as { setup: { seed: string }; actions: Action[] }[];

async function start(page: Page, seed: string) {
  await page.goto("/");
  await page.getByRole("button", { name: /ゲーム開始/ }).click();
  await page.getByLabel(/乱数シード/).fill(seed);
  await page.getByRole("button", { name: /公開行動の試遊をはじめる/ }).click();
  await settleScreens(page);
}

test("イベント結果確認の保存に失敗してもダイアログから同じ結果を再保存できる", async ({
  page,
}) => {
  await start(page, run.setup.seed);
  await page.evaluate(
    async ({ actions, key }) => {
      const { useGameStore } = await new Function(
        "return import('/src/stores/game.ts')",
      )();
      const store = useGameStore();
      for (const action of actions) {
        store.act(action);
        if (store.error || store.pending) throw Error(store.error);
      }
      const set = Storage.prototype.setItem;
      let failed = false;
      const writes: string[] = [];
      (window as Window & { auditWrites?: string[] }).auditWrites = writes;
      Storage.prototype.setItem = function (name, value) {
        if (name === key) {
          writes.push(value);
          if (!failed) {
            failed = true;
            throw new DOMException("forced", "QuotaExceededError");
          }
        }
        set.call(this, name, value);
      };
    },
    {
      actions: run.actions.slice(
        0,
        run.actions.findIndex((a) => a.type === "eventAck"),
      ),
      key,
    },
  );
  const saved = await page.evaluate((key) => localStorage.getItem(key), key);
  await page
    .getByRole("dialog", { name: "共通イベントの結果" })
    .getByRole("button", { name: "確認した" })
    .click();
  const retry = page.getByRole("dialog", { name: "保存に失敗しました" });
  await expect(retry).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    saved,
  );
  await retry.getByRole("button", { name: "保存を再試行" }).click();
  const writes = await page.evaluate(
    () => (window as Window & { auditWrites?: string[] }).auditWrites!,
  );
  expect(writes).toHaveLength(2);
  expect(writes[0]).toBe(writes[1]);
  await expect(retry).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "続きから" }).click();
  await expect(
    page.getByRole("heading", { name: "今夜、固有魔法を使いますか？" }),
  ).toBeVisible();
});

test("休息・研鑽の研究プレビューが支払いと成長に一致し、手引きに首席の同点条件がある", async ({
  page,
}) => {
  await start(page, "v20-smoke-1");
  await page.evaluate(async () => {
    const { useGameStore } = await new Function(
      "return import('/src/stores/game.ts')",
    )();
    const store = useGameStore();
    const state = structuredClone(store.state);
    state.players[0].rest = 2;
    state.players[0].publicPotions = ["scholarship"];
    state.players[0].inventory = [{ id: state.nextItem++, kind: "obsidian" }];
    store.state = state;
  });
  await page.getByText("遊び方・勝敗条件", { exact: true }).click();
  await expect(page.locator(".quick-guide")).toContainText(
    "FPが同点なら日次課題の達成数",
  );
  await expect(page.locator(".quick-guide")).toContainText("共同首席");
  await page.getByRole("button", { name: "研究", exact: true }).click();
  const card = page
    .locator(".action-card")
    .filter({ has: page.getByRole("heading", { name: "火を研究" }) });
  await expect(card).toContainText("成長：+2");
  await card.getByRole("combobox").selectOption("obsidian");
  await expect(card).toContainText("黒曜石：必要1");
  await expect(card).not.toContainText("魔力結晶：必要");
  await card.getByRole("button", { name: "研究 1AP" }).click();
  const result = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).state.players[0],
    key,
  );
  expect(result.stats.attack).toBe(5);
  expect(result.inventory).toEqual([]);
});

test("通算2失敗のE06を、残りのAIが1・2・1点を仮納品して救う", async ({
  page,
}) => {
  await start(page, "v20-smoke-1");
  await page.evaluate(async () => {
    const { useGameStore } = await new Function(
      "return import('/src/stores/game.ts')",
    )();
    const store = useGameStore();
    const state = structuredClone(store.state);
    state.failed = 2;
    state.event.id = 6;
    state.publicTurn.round = 2;
    for (const [id, capacity] of [
      [1, 1],
      [2, 2],
      [3, 1],
    ]) {
      const p = state.players[id];
      p.stats = { attack: capacity + 1, defense: 1, insight: 1 };
      p.ap = 1;
      p.inventory = [];
      p.longGoal = { id: 5, targets: [id === 1 ? 2 : 1], achieved: false };
    }
    store.state = state;
  });
  await page.getByRole("button", { name: /手番終了 \/ パス/ }).click();
  const result = page.getByRole("dialog", { name: "共通イベントの結果" });
  await expect(result).toContainText("封印陣の亀裂：成功");
  await expect(result).toContainText("失敗 2/3");
  const firstReservations = await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key)!).state;
    return state.logs
      .filter((log: { type: string }) => log.type === "reserve")
      .slice(0, 3)
      .map((log: { data: { units: number } }) => log.data.units);
  }, key);
  expect(firstReservations).toEqual([1, 2, 1]);
});
