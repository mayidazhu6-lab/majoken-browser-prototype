import { expect, test, type Page } from "@playwright/test";
import { settleScreens } from "./helpers";

const saveKey = "majoken-save-rules-2.0.4";
const save = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), saveKey);

async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /ゲーム開始/ }).click();
  await page.getByRole("checkbox", { name: "開発者モード" }).check();
  await page.getByLabel("乱数シード", { exact: true }).fill("v20-smoke-1");
  await page.getByRole("button", { name: "研究開始", exact: true }).click();
  await settleScreens(page);
  await page.getByRole("checkbox", { name: "開発者モード" }).uncheck();
}

test("呪詛で研究素材が不足してもキャンセルで状態やAPを消費しない", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(async () => {
    const { useGameStore } = await new Function(
      "return import('/src/stores/game.ts')",
    )();
    const store = useGameStore();
    const state = structuredClone(store.state);
    const player = state.players[0];
    player.curse = 1;
    player.inventory = ["obsidian", "crystal"].map((kind) => ({
      id: state.nextItem++,
      kind,
    }));
    store.state = state;
    store.save();
    store.notice = "";
  });
  const initialSave = await save(page);
  const open = page.getByRole("button", { name: "研究（1AP）", exact: true });
  const fire = page
    .locator(".research-card")
    .filter({ has: page.getByRole("heading", { name: "火を研究" }) });
  await open.click();
  const material = fire.getByRole("combobox");
  await material.selectOption("obsidian");
  await expect(fire).toContainText("黒曜石：必要2 / 使用可能1");
  await expect(fire).toContainText("魔力結晶：必要1 / 使用可能1");
  await expect(fire.getByRole("button", { name: "研究 1AP" })).toBeDisabled();
  await page.getByRole("button", { name: "キャンセルして戻る" }).click();
  expect(await save(page)).toBe(initialSave);
  await open.click();
  await expect(material).toHaveValue("素材を選択");
  await expect(fire).toContainText("追加素材を選ぶ");
});

test("能力納品で風Lvが下がっても解放済みレシピを維持し、再到達時に再解放を予告しない", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await page.evaluate(async () => {
    const { useGameStore } = await new Function(
      "return import('/src/stores/game.ts')",
    )();
    const { unlockNightRecipes } = await new Function(
      "return import('/src/domain/night.ts')",
    )();
    const { reserve, resolveEvent } = await new Function(
      "return import('/src/domain/events.ts')",
    )();
    const store = useGameStore();
    const state = structuredClone(store.state);
    const player = state.players[0];
    player.stats = { attack: 5, defense: 9, insight: 6 };
    unlockNightRecipes(player);
    const nextPublicEvent = structuredClone(state.event);
    state.event.id = 6;
    state.publicTurn.round = 2;
    reserve(state, player, [], { attack: 1, defense: 2, insight: 1 });
    resolveEvent(state);
    // Give the post-donation player another public turn to preview research.
    state.event = nextPublicEvent;
    player.inventory = ["water", "sand"].map((kind) => ({
      id: state.nextItem++,
      kind,
    }));
    player.rest = 2;
    player.curse = 2;
    store.state = state;
  });
  await page.getByRole("button", { name: /能力値/ }).click();
  const attributes = page.getByRole("dialog", { name: "能力値", exact: true });
  const wind = attributes.locator('[data-stat="insight"]');
  await expect(wind).toContainText("恒久能力値 5 / Lv1");
  await expect(wind).toContainText("戦闘ダメージ ＋0");
  await expect(wind).toContainText("解放済みレシピ：通常薬・上位薬");
  await expect(wind).toContainText("Lv2まであと1点");
  await expect(wind).toContainText("すでに解放済み");
  await expect(attributes.locator('[data-stat="defense"]')).toContainText(
    "警戒ボーナス ＋1",
  );
  await expect(attributes.locator('[data-stat="defense"]')).toContainText(
    "Lv3まであと2点",
  );
  await attributes.screenshot({
    path: testInfo.outputPath("attributes-mobile.png"),
  });
  await attributes.getByRole("button", { name: "閉じる", exact: true }).click();

  await page.getByRole("button", { name: "研究（1AP）", exact: true }).click();
  const card = page
    .locator(".research-card")
    .filter({ has: page.getByRole("heading", { name: "風を研究" }) });
  await expect(card).toContainText("恒久能力値 5 → 6");
  await expect(card).toContainText("Lv1 → Lv2");
  await expect(card).toContainText("すでに解放済み");
  await expect(card).toContainText("精霊水：必要1");
  await expect(card).toContainText("星の砂：必要1");
  await expect(card.getByRole("combobox")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "研究 1AP" })).toBeEnabled();
  await card.screenshot({ path: testInfo.outputPath("research-mobile.png") });

  await page.evaluate(async () => {
    const { useGameStore } = await new Function(
      "return import('/src/stores/game.ts')",
    )();
    const store = useGameStore();
    const state = structuredClone(store.state);
    state.players[0].stats.insight = 8;
    store.state = state;
  });
  await expect(card).toContainText("恒久能力値 8 → 9");
  await expect(card).toContainText("Lv2 → Lv3");
  await expect(card).toContainText(
    "最上位薬のレシピ解放（浄化の薬・透明の薬・剛力の薬）",
  );
  await card.getByRole("button", { name: "研究 1AP" }).click();
  const player = JSON.parse((await save(page))!).state.players[0];
  expect(player.stats.insight).toBe(9);
  expect(player.recipes).toEqual(
    expect.arrayContaining(["purification", "invisibility", "might"]),
  );
});
