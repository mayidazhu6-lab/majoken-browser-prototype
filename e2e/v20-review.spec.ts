import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { settleScreens } from "./helpers";
import type { Action } from "../src/domain/types";

const key = "majoken-save-rules-2.1";
const [run] = JSON.parse(
  readFileSync("tests/fixtures/v20-runs.json", "utf8"),
) as { setup: { seed: string }; actions: Action[] }[];

async function start(page: Page, seed: string) {
  await page.goto("/");
  await page.getByRole("button", { name: /ゲーム開始/ }).click();
  await page.getByRole("checkbox", { name: "開発者モード" }).check();
  await page.getByLabel(/乱数シード/).fill(seed);
  await page.getByRole("button", { name: "研究開始", exact: true }).click();
  await settleScreens(page);
}

test("イベント結果確認の保存に失敗してもダイアログから同じ結果を再保存できる", async ({
  page,
}) => {
  const key = "majoken-save-rules-2.0.2";
  await start(page, run.setup.seed);
  await page.evaluate(
    async ({ actions, key }) => {
      const { useGameStore } = await new Function(
        "return import('/src/stores/game.ts')",
      )();
      const store = useGameStore();
      // This fixed historical action list belongs to the pre-tiebreak engine.
      const { createGame } = await new Function(
        "return import('/src/domain/reducer.ts')",
      )();
      const { serialize } = await new Function(
        "return import('/src/domain/persistence.ts')",
      )();
      store.load(serialize(createGame(store.state.setup, "browser-2.0.2")));
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
  await page.getByRole("button", { name: "旧v2.0.2の続きから" }).click();
  await expect(
    page.getByRole("heading", { name: "今夜、固有魔法を使いますか？" }),
  ).toBeVisible();
});

test("休息・研鑽の研究プレビューが支払いと成長に一致し、手引きに首席の同点条件がある", async ({
  page,
}, testInfo) => {
  await start(page, "v20-smoke-1");
  await page.evaluate(async () => {
    const { useGameStore } = await new Function(
      "return import('/src/stores/game.ts')",
    )();
    const store = useGameStore();
    const state = structuredClone(store.state);
    state.players[0].rest = 2;
    state.players[0].stats.attack = 4;
    state.players[0].publicPotions = ["scholarship"];
    state.players[0].inventory = [{ id: state.nextItem++, kind: "obsidian" }];
    store.state = state;
  });
  await page.getByRole("button", { name: "遊び方・ルール説明" }).click();
  const guide = page.getByRole("dialog", { name: "遊び方・ルール説明" });
  await guide.getByText("名声ポイント（FP）", { exact: true }).click();
  await expect(
    guide.getByText(/同点なら「今日の課題」の達成日数/),
  ).toBeVisible();
  await guide.getByText("エンディングと勝利条件", { exact: true }).click();
  await expect(guide.getByText(/1位が複数なら共同首席/)).toBeVisible();
  await guide.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("button", { name: "研究（1AP）", exact: true }).click();
  const card = page
    .locator(".action-card")
    .filter({ has: page.getByRole("heading", { name: "火を研究" }) });
  await expect(card).toContainText("恒久能力値 4 → 6（＋2、研鑽の薬 ＋1込み）");
  await expect(card).toContainText("Lv1 → Lv2");
  await expect(card).toContainText("襲撃ボーナスがさらに ＋1");
  await card.getByRole("combobox").selectOption("obsidian");
  await expect(card).toContainText("黒曜石：必要1");
  await expect(card).not.toContainText("魔力結晶：必要");
  await card.screenshot({ path: testInfo.outputPath("research-desktop.png") });
  await card.getByRole("button", { name: /研究(?:する|不可)（1AP）/ }).click();
  const result = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).state.players[0],
    key,
  );
  expect(result.stats.attack).toBe(6);
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
  const health = page.getByRole("region", { name: "研究所の残り耐久" });
  await expect(health.locator(".health-gem")).toHaveCount(3);
  await expect(health.locator(".health-gem.filled")).toHaveCount(1);
  await expect(health).toContainText("1 / 3");
  await expect(health).toHaveClass(/danger/);
  await expect(health).toContainText("次に失敗すると崩壊");
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

test("取引の保存を再試行すると内訳が表示され、取引は一度だけ成立する", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await start(page, "v20-smoke-6");
  for (let round = 1; round <= 2; round++) {
    await settleScreens(page);
    await page
      .getByRole("button", { name: "採集（1AP）", exact: true })
      .click();
    await page.getByRole("button", { name: "採集 1AP" }).click();
    await settleScreens(page);
    await page.getByRole("button", { name: /手番終了 \/ パス/ }).click();
  }
  const trade = page.getByRole("dialog", { name: /からの取引提案/ });
  await expect(trade).toBeVisible();
  const received = (await trade.getByText(/受け取る：/).textContent())!
    .split("：")[1]
    .split(" ×")[0];
  const before = await page.evaluate((key) => {
    const set = Storage.prototype.setItem;
    let failed = false;
    Storage.prototype.setItem = function (name, value) {
      if (name === key && !failed) {
        failed = true;
        throw new DOMException("forced", "QuotaExceededError");
      }
      set.call(this, name, value);
    };
    return localStorage.getItem(key);
  }, key);

  await trade.getByRole("button", { name: "受諾", exact: true }).click();
  const retry = page.getByRole("dialog", { name: "保存に失敗しました" });
  await expect(retry).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    before,
  );
  await retry.getByRole("button", { name: "保存を再試行" }).click();
  await page
    .getByRole("dialog", { name: "共通イベントの結果" })
    .getByRole("button", { name: "確認した" })
    .click();
  const notice = page.locator(".alert").filter({ hasText: "と取引成立" });
  await expect(notice).toContainText("渡した品：なし");
  await expect(notice).toContainText("受け取った品：" + received);
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).state,
    key,
  );
  expect(
    saved.actions.filter((a: Action) => a.type === "tradeReply"),
  ).toHaveLength(1);
});

test("取引の入力を保ったまま持ち物と課題を確認できる", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await start(page, "v20-smoke-1");
  await page
    .getByRole("button", { name: "魔女間取引（0AP）", exact: true })
    .click();
  const target = page.getByRole("combobox", { name: "相手", exact: true });
  await target.selectOption("2");
  await page
    .getByText("自分が渡す数・相手から受け取る数を入力", { exact: true })
    .click();
  const request = page.getByRole("spinbutton", { name: "黒曜石 要求数" });
  await request.fill("2");

  const menu = page.getByRole("navigation", { name: "共通メニュー" });
  for (const name of ["持ち物", "課題"]) {
    const opener = menu.getByRole("button", { name: new RegExp(name) });
    await opener.click();
    const dialog = page.getByRole("dialog", { name, exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
    await expect(opener).toBeFocused();
    await expect(target).toHaveValue("2");
    await expect(request).toBeVisible();
    await expect(request).toHaveValue("2");
  }
});
