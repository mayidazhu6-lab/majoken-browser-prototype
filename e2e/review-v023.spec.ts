import { test, expect, type Page } from "@playwright/test";
import { createGame, dispatch } from "../src/domain/reducer";
import { serialize } from "../src/domain/persistence";
import { simulationAction } from "../src/domain/simulation";
import { RECIPES, recipe } from "../src/domain/items";
import { MATERIALS, LABELS } from "../src/domain/config";
import type { GameState } from "../src/domain/types";
const setup = {
  name: "アリア",
  seed: "witches-2026",
  magic: "illusion" as const,
  stats: { attack: 4, defense: 3, insight: 3 },
};
async function state(page: Page): Promise<GameState> {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem("majoken-save-v2")!).state,
  );
}
async function load(page: Page, s: GameState) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "review.json",
    mimeType: "application/json",
    buffer: Buffer.from(serialize(s)),
  });
  await expect(page.locator(".alert.error")).toHaveCount(0);
}
function nightFixture() {
  let s = createGame({ ...setup, magic: "barrier" });
  for (let n = 0; s.phase !== "night" && n < 200; n++)
    s = dispatch(s, simulationAction(s));
  if (s.phase !== "night") throw Error("night fixture missing");
  return s;
}
test("未所持・未解放も含む全14レシピを実行前に確認でき、追加可否は従来どおり", async ({
  page,
}) => {
  const s = nightFixture();
  await load(page, s);
  await page
    .locator(".night-options")
    .getByRole("button", { name: "錬金", exact: true })
    .click();
  const descriptions: Record<string, string> = {
    vigor: "+1",
    study: "+1",
    cleanse: "自動消費",
    watch: "+1",
    sight: "最大2個",
    harvest: "+3",
    wisdom: "+3",
    purify: "呪詛も無効化",
    aegis: "+3",
    omniscience: "すべて",
    strike: "+4",
    iron: "+4",
    focus: "+4",
    talent: "翌日から反映",
  };
  await expect(
    page.getByLabel("レシピ", { exact: true }).locator("option"),
  ).toHaveCount(RECIPES.length);
  for (const r of RECIPES) {
    await page.getByLabel("レシピ", { exact: true }).selectOption(r.id);
    const preview = page.getByRole("region", { name: "選択した薬の詳細" });
    await expect(preview.getByRole("heading")).toHaveText(r.name);
    await expect(preview).toContainText(descriptions[r.id]);
    for (const kind of new Set(r.materials))
      await expect(preview).toContainText(
        `${LABELS[kind]}：1個作成に必要${r.materials.filter((k) => k === kind).length}個 / 現在の所持数${s.players[0].inventory.filter((i) => i.kind === kind).length}個`,
      );
    if (
      r.tier === "combat" ||
      (r.tier === "special" && !s.players[0].recipes.includes(r.id))
    )
      await expect(
        page.getByRole("button", { name: "作成予定に追加", exact: true }),
      ).toBeDisabled();
  }
  expect(await state(page)).toEqual(s);
  await page.screenshot({
    path: "docs/reports/v023-alchemy-review.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "キャンセルして戻る", exact: true })
    .click();
  expect(await state(page)).toEqual(s);
});
test("複数作成予定の素材数は追加・削除で即時更新し過剰作成を許さない", async ({
  page,
}) => {
  const s = nightFixture(),
    a = simulationAction(s);
  if (a.type !== "night" || a.choice.kind !== "brew")
    throw Error("brew fixture missing");
  const plan = a.choice.recipes!;
  expect(plan.length).toBeGreaterThan(1);
  expect(new Set(plan).size).toBeLessThan(plan.length);
  await load(page, s);
  await page
    .locator(".night-options")
    .getByRole("button", { name: "錬金", exact: true })
    .click();
  const chosen: string[] = [];
  async function counts() {
    for (const kind of MATERIALS) {
      const owned = s.players[0].inventory.filter(
        (i) => i.kind === kind,
      ).length;
      const consumed = chosen.reduce(
        (n, id) => n + recipe(id)!.materials.filter((k) => k === kind).length,
        0,
      );
      await expect(
        page.locator(`.brew-materials [data-material="${kind}"] td`),
      ).toHaveText([String(owned), String(consumed), String(owned - consumed)]);
    }
    expect(await state(page)).toEqual(s);
  }
  await counts();
  for (const id of plan) {
    await page.getByLabel("レシピ", { exact: true }).selectOption(id);
    await page
      .getByRole("button", { name: "作成予定に追加", exact: true })
      .click();
    chosen.push(id);
    await counts();
  }
  await expect(
    page.getByRole("button", { name: "作成予定に追加", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".operation-reason")).toContainText("不足");
  await page.getByRole("button", { name: "削除", exact: true }).first().click();
  const removed = chosen.shift()!;
  await counts();
  await page.getByLabel("レシピ", { exact: true }).selectOption(removed);
  await expect(
    page.getByRole("button", { name: "作成予定に追加", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "作成予定に追加", exact: true })
    .click();
  chosen.push(removed);
  await counts();
  await page
    .getByRole("button", { name: "秘匿行動を確定", exact: true })
    .click();
  expect((await state(page)).players[0].night?.recipes).toEqual(chosen);
});
test("幻惑の発動ラウンドと変更内容を公開・判定・履歴に表示し戦闘中は切り替えない", async ({
  page,
}) => {
  let found: GameState | undefined;
  for (let n = 0; n < 15 && !found; n++) {
    let s = createGame({ ...setup, seed: `illusion-review-${n}` });
    for (let step = 0; s.phase !== "ended" && step < 400; step++) {
      const c = s.combat;
      if (
        c?.participants.includes(0) &&
        c.rounds.some((r) => r.original.some((v, i) => v !== r.choices[i]))
      ) {
        found = s;
        break;
      }
      let action = simulationAction(s);
      if (
        s.phase === "magic" &&
        s.event.acknowledged &&
        !s.players[0].activeMagic &&
        s.players[0].availableDay <= s.day
      )
        action = { type: "magic", player: 0 };
      if (s.phase === "night" && !s.players[0].night)
        action = {
          type: "night",
          player: 0,
          choice: { kind: "raid", target: 1 },
        };
      s = dispatch(s, action);
    }
  }
  if (!found) throw Error("illusion fixture missing");
  // Resume the stored battle, then inspect the already resolved rounds.
  await load(page, found);
  const c = found.combat!,
    index = c.rounds.findIndex((r) =>
      r.original.some((v, i) => v !== r.choices[i]),
    );
  if (c.done) {
    const dialog = page.getByRole("dialog");
    await dialog.getByText("各ラウンドの判定履歴", { exact: true }).click();
  } else {
    await page.getByRole("button", { name: "行動選択へ", exact: true }).click();
    await expect(page.locator(".illusion-status input")).toBeDisabled();
    await page.getByText("前のラウンドの判定を見る", { exact: true }).click();
  }
  await expect(page.locator(".illusion-result")).toContainText(
    `第${index + 1}ラウンドに幻惑が発動`,
  );
  await expect(page.locator(".illusion-result")).toContainText(
    "変更後の行動で判定",
  );
  expect(await state(page)).toEqual(found);
});
