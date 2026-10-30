import { test, expect, type Page } from "@playwright/test";
import { createGame, dispatch } from "../src/domain/reducer";
import { simulationAction, simulate } from "../src/domain/simulation";
import { serialize } from "../src/domain/persistence";
import type { GameState } from "../src/domain/types";

const setup = {
  name: "アリア",
  seed: "witches-2026",
  magic: "barrier" as const,
  stats: { attack: 4, defense: 3, insight: 3 },
};
async function state(page: Page): Promise<GameState> {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem("majoken-save-v2")!).state,
  );
}
async function importState(page: Page, s: GameState) {
  await page.locator('input[type="file"]').setInputFiles({
    name: "v02.json",
    mimeType: "application/json",
    buffer: Buffer.from(serialize(s)),
  });
  await expect(page.locator(".alert.error")).toHaveCount(0);
}

test("v0.1領域を保持し、続行・JSON取込は版不一致。新規保存はv0.2だけ", async ({
  page,
}) => {
  await page.goto("/");
  const old = JSON.stringify({
    format: "majoken-save",
    version: 1,
    state: { rulesVersion: "browser-0.1+decisions-1" },
  });
  await page.evaluate(
    (raw) => localStorage.setItem("majoken-save-v1", raw),
    old,
  );
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  await expect(page.locator(".alert.error")).toContainText(
    "バージョンが一致しません",
  );
  await page.getByRole("button", { name: /8日間の研究をはじめる/ }).click();
  expect(
    await page.evaluate(() => localStorage.getItem("majoken-save-v1")),
  ).toBe(old);
  const before = await state(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "v01.json",
    mimeType: "application/json",
    buffer: Buffer.from(old),
  });
  await expect(page.locator(".alert.error")).toContainText(
    "バージョンが一致しません",
  );
  expect(await state(page)).toEqual(before);
  expect(
    await page.evaluate(() => localStorage.getItem("majoken-save-v1")),
  ).toBe(old);
});

test("公開手番・AI自動進行・未決取引の保存再開・拒否後の復帰", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("乱数シード").fill("lab-77");
  await page.getByRole("button", { name: /8日間の研究をはじめる/ }).click();
  await expect(page.locator(".daily-ho-notice")).toContainText(
    "達成報酬：FP+1",
  );
  await expect(
    page.locator(".tabs").getByRole("button", { name: "錬金", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "AIの行動を進める", exact: true }),
  ).toHaveCount(0);
  expect((await state(page)).players.map((p) => p.ap)).toEqual([2, 2, 2, 2]);
  await page.getByRole("button", { name: /採集 1AP/ }).click();
  await expect(page.getByRole("button", { name: /採集 1AP/ })).toBeDisabled();
  await page.locator(".progression button.primary").click();
  const pending = await state(page);
  expect(pending.trades).toHaveLength(1);
  expect(pending.publicTurn.index).toBe(3);
  await expect(page.locator(".progression button.primary")).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  expect(await state(page)).toEqual(pending);
  await page.getByRole("button", { name: "拒否", exact: true }).click();
  const resumed = await state(page);
  expect(resumed.trades).toHaveLength(0);
  expect(resumed.publicTurn.round).toBe(2);
  expect(resumed.publicTurn.index).toBe(0);
  expect(resumed.publicTurn.tradeAttempts["1:3:0"]).toBe(1);
  expect(resumed.players.map((p) => p.ap)).toEqual([1, 1, 1, 1]);
  const seqs = await page
    .locator(".journal [data-log-seq]")
    .evaluateAll((nodes) =>
      nodes.map((n) => Number(n.getAttribute("data-log-seq"))),
    );
  expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
  const ordered = await page
    .locator(".public-history [data-public-seq]")
    .evaluateAll((nodes) =>
      nodes.map((n) => Number(n.getAttribute("data-public-seq"))),
    );
  expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
  await page.screenshot({
    path: "/tmp/majoken-v02-public.png",
    fullPage: true,
  });
});

test("夜錬金の追加・削除・素材不足拒否・複数確定・保存再開", async ({
  page,
}) => {
  let s = createGame(setup);
  for (let n = 0; s.phase !== "night" && n < 100; n++)
    s = dispatch(s, simulationAction(s));
  expect(s.phase).toBe("night");
  const action = simulationAction(s);
  if (action.type !== "night" || action.choice.kind !== "brew")
    throw Error("錬金可能な試験状態が必要");
  const plan = action.choice.recipes!;
  expect(plan.length).toBeGreaterThan(1);
  await page.goto("/");
  await importState(page, s);
  await page
    .locator(".night-options")
    .getByRole("button", { name: "錬金", exact: true })
    .click();
  for (const id of plan) {
    await page.getByLabel("レシピ", { exact: true }).selectOption(id);
    await page
      .getByRole("button", { name: "作成予定に追加", exact: true })
      .click();
  }
  await expect(
    page.getByRole("button", { name: "秘匿行動を確定", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "作成予定に追加", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "秘匿行動を確定", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "削除", exact: true }).last().click();
  await page
    .getByRole("button", { name: "秘匿行動を確定", exact: true })
    .click();
  expect((await state(page)).players[0].night?.recipes).toEqual(plan);
  await expect(
    page
      .locator(".night-options")
      .getByRole("button", { name: "休息", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  await expect(
    page.getByText(`作成予定 ${plan.length} 個（固定上限なし）`, {
      exact: true,
    }),
  ).toBeVisible();
  await page.locator(".progression button.primary").click();
  expect(
    (await state(page)).logs.filter((l) => l.type === "brew" && l.actor === 0),
  ).toHaveLength(plan.length);
});

test("同日付の保存JSON読込で確定済み夜行動・対象・複数錬金の表示を同期", async ({
  page,
}) => {
  let base = createGame(setup);
  for (let n = 0; base.phase !== "night" && n < 100; n++)
    base = dispatch(base, simulationAction(base));
  expect(base.phase).toBe("night");
  const scout = dispatch(base, {
    type: "night",
    player: 0,
    choice: { kind: "scout", target: 2 },
  });
  const three = dispatch(base, {
    type: "night",
    player: 0,
    choice: { kind: "brew", recipes: ["study", "study", "watch"] },
  });
  const two = dispatch(base, {
    type: "night",
    player: 0,
    choice: { kind: "brew", recipes: ["cleanse", "watch"] },
  });
  await page.goto("/");
  await importState(page, scout);
  const panel = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "秘密の行動をひとつ。",
      exact: true,
    }),
  });
  await expect(panel.locator(".night-options button.chosen")).toHaveText(
    "偵察",
  );
  for (const [saved, count, studyCount, cleanseCount] of [
    [three, 3, 2, 0],
    [two, 2, 0, 1],
  ] as const) {
    expect(saved.day).toBe(scout.day);
    await importState(page, saved);
    expect(await state(page)).toEqual(saved);
    await expect(panel.locator(".night-options button.chosen")).toHaveText(
      "錬金",
    );
    await expect(
      panel.getByText(`作成予定 ${count} 個（固定上限なし）`, { exact: true }),
    ).toBeVisible();
    await expect(
      panel.locator("p").filter({ hasText: "研鑽の薬" }),
    ).toHaveCount(studyCount);
    await expect(
      panel.locator("p").filter({ hasText: "浄化の薬" }),
    ).toHaveCount(cleanseCount);
    await expect(
      panel.locator("p").filter({ hasText: "守護の薬" }),
    ).toHaveCount(1);
    await expect(
      panel.getByRole("button", { name: "作成予定に追加", exact: true }),
    ).toBeDisabled();
    await expect(
      panel.getByRole("button", { name: "削除", exact: true }),
    ).toHaveCount(count);
  }
  await importState(page, scout);
  await expect(panel.locator(".night-options button.chosen")).toHaveText(
    "偵察",
  );
  await expect(panel.getByLabel("対象", { exact: true })).toHaveValue("2");
  await expect(panel.getByLabel("対象", { exact: true })).toBeDisabled();
  await expect(
    panel.getByRole("button", { name: "削除", exact: true }),
  ).toHaveCount(0);
  // Reloading an uncommitted save also clears local drafts on the same day.
  await importState(page, base);
  await expect(panel.locator(".night-options button.chosen")).toHaveText(
    "休息",
  );
  await panel
    .locator(".night-options")
    .getByRole("button", { name: "錬金", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "作成予定に追加", exact: true })
    .click();
  await importState(page, base);
  await expect(panel.locator(".night-options button.chosen")).toHaveText(
    "休息",
  );
  await panel
    .locator(".night-options")
    .getByRole("button", { name: "錬金", exact: true })
    .click();
  await expect(
    panel.getByText("作成予定 0 個（固定上限なし）", { exact: true }),
  ).toBeVisible();
});

test("秘匿決闘の当事者には内訳を表示し、第三者の戦闘・薬・HO・取引ログを表示しない", async ({
  page,
}) => {
  const s = simulate("moon-42");
  const hidden = s.combatHistory.filter(
    (c) => c.kind === "secret" && !c.participants.includes(0),
  );
  const own = s.combatHistory.filter(
    (c) => c.kind === "secret" && c.participants.includes(0),
  );
  expect(hidden.length).toBeGreaterThan(0);
  expect(own.length).toBeGreaterThan(0);
  await page.goto("/");
  await importState(page, s);
  const history = page.getByText("対戦の履歴（秘匿決闘は本人参加分のみ）", {
    exact: true,
  });
  await history.click();
  for (const c of hidden)
    await expect(page.locator(`[data-combat-id="${c.id}"]`)).toHaveCount(0);
  for (const c of own) {
    await expect(page.locator(`[data-combat-id="${c.id}"]`)).toContainText(
      "基礎",
    );
    await expect(page.locator(`[data-combat-id="${c.id}"]`)).toContainText(
      "カウンター",
    );
  }
  const forbidden = s.logs.filter(
    (l) =>
      l.audience === "dev" ||
      (Array.isArray(l.audience) && !l.audience.includes(0)),
  );
  const visibleSeqs = await page
    .locator(".journal [data-log-seq]")
    .evaluateAll((nodes) =>
      nodes.map((n) => Number(n.getAttribute("data-log-seq"))),
    );
  expect(visibleSeqs.some((seq) => forbidden.some((l) => l.seq === seq))).toBe(
    false,
  );
  await expect(page.locator(".debug")).toHaveCount(0);
});

test("戦闘中と報酬選択待ちの保存再開、解決後も2AP決闘の元手番を保持", async ({
  page,
}) => {
  let s = createGame({
    ...setup,
    seed: "reward-5",
    stats: { attack: 2, defense: 2, insight: 6 },
  });
  s = dispatch(s, { type: "duel", player: 0, target: 1 });
  await page.goto("/");
  await importState(page, s);
  for (let n = 0; n < 5; n++) {
    await page.reload();
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    await page
      .locator(".stance-options")
      .getByRole("button", {
        name: n % 2 === 0 ? "ためる" : "防御",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: /手を確定/ }).click();
  }
  expect((await state(page)).phase).toBe("rewards");
  await page.reload();
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  await expect(page.locator(".combat-panel")).toContainText("次Rため");
  await page
    .getByRole("button", { name: "既定の能力を選ぶ", exact: true })
    .click();
  const resumed = await state(page);
  expect(resumed.phase).toBe("public");
  expect(resumed.publicTurn.round).toBe(1);
  expect(resumed.publicTurn.acted).toBe(true);
  expect(resumed.players[0].ap).toBe(0);
  expect(resumed.combatHistory).toHaveLength(1);
});
