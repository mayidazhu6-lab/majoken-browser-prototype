import { expect, test } from "@playwright/test";
import { createGame, dispatch } from "../src/domain/reducer";
import { simulationAction } from "../src/domain/simulation";
import { V20_RULES_VERSION } from "../src/domain/config";
import { serialize } from "../src/domain/persistence";
import { NIGHT_RECIPES } from "../src/domain/night";
import { materialIds } from "../src/domain/items";
import type { Action } from "../src/domain/types";
const key = "majoken-save-rules-2.0.4";
function nightFixture(brew: boolean) {
  for (let i = 0; i < 80; i++) {
    let s = createGame(
      {
        name: "アリア",
        seed: `staged-night-${i}`,
        magic: "barrier",
        stats: { attack: 3, defense: 3, insight: 3 },
      },
      V20_RULES_VERSION,
    );
    for (let n = 0; n < 60 && !s.result && s.phase !== "night"; n++)
      s = dispatch(s, simulationAction(s));
    if (s.phase !== "night") continue;
    const recipe = NIGHT_RECIPES.find(
      (r) =>
        s.players[0].recipes.includes(r.id) &&
        materialIds(s.players[0], r.materials),
    );
    if (brew && !recipe) continue;
    const plan = brew ? [recipe!.id] : [];
    const confirmed = dispatch(s, {
      type: "night",
      player: 0,
      choice: { kind: "rest", target: 1, recipes: plan },
    });
    const resolved = dispatch(confirmed, { type: "advance" });
    if (resolved.phase === "ho")
      return { initial: s, confirmed, resolved, plan };
  }
  throw Error("No valid night fixture");
}
for (const brew of [false, true]) {
  test(`確定と解決を段階表示し、待機・再開・二重実行を確認（錬金${brew ? "あり" : "なし"}）`, async ({
    page,
  }, testInfo) => {
    const { initial, confirmed, resolved, plan } = nightFixture(brew);
    await page.addInitScript(
      ({ key, json }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, json);
      },
      { key, json: serialize(initial) },
    );
    await page.goto("/");
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    expect(
      await page.evaluate(() => ({
        dpr: devicePixelRatio,
        scale: visualViewport?.scale,
      })),
    ).toEqual({ dpr: 1, scale: 1 });
    const resolve = page.getByRole("button", { name: /秘匿行動を解決/ });
    await expect(resolve).toHaveCount(0);
    await page.getByRole("button", { name: "休息", exact: true }).click();
    if (brew) {
      await page
        .getByRole("combobox", { name: /^レシピ/ })
        .selectOption(plan[0]);
      await page
        .getByRole("button", { name: "作成予定に追加", exact: true })
        .click();
    }
    await page.screenshot({
      path: testInfo.outputPath("before-confirm.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "夜間行動と錬金を確定", exact: true })
      .click();
    const status = page.getByRole("region", {
      name: "夜間行動の確定状況",
      exact: true,
    });
    await expect(status).toContainText("変更はできません");
    await expect(status.locator("li")).toHaveText(
      initial.players.map((p) => `${p.name}：確定済み`),
    );
    expect(
      JSON.parse(
        (await page.evaluate((key) => localStorage.getItem(key), key))!,
      ).state,
    ).toEqual(JSON.parse(JSON.stringify(confirmed)));
    await expect(resolve).toBeEnabled();
    // Exercise the waiting presentation without changing the actual AI or saved fixture.
    await page.evaluate(async () => {
      const { useGameStore } = await new Function(
        "return import('/src/stores/game.ts')",
      )();
      const store = useGameStore();
      const s = structuredClone(store.state);
      s.players[1].night = undefined;
      store.state = s;
    });
    await expect(status).toContainText("他の魔女の確定を待っています");
    await expect(resolve).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    await expect(resolve).toBeEnabled();
    await page.screenshot({
      path: testInfo.outputPath("confirmed.png"),
      fullPage: true,
    });
    await resolve.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect(resolve).toHaveCount(0);
    await expect(status).toHaveCount(0);
    const saved = await page.evaluate((key) => localStorage.getItem(key), key);
    expect(JSON.parse(saved!).state).toEqual(
      JSON.parse(JSON.stringify(resolved)),
    );
    await page.reload();
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      saved,
    );
  });
}

test("ネムへの秘匿襲撃勝利が卒業課題に反映され、再開しても保持される", async ({
  page,
}) => {
  let s = createGame(
    {
      name: "アリア",
      seed: "nemu-goal-151",
      magic: "barrier",
      stats: { attack: 3, defense: 3, insight: 3 },
    },
    V20_RULES_VERSION,
  );
  for (let n = 0; n < 220 && !s.result; n++) {
    const a: Action =
      s.phase === "night" && !s.players[0].night
        ? {
            type: "night",
            player: 0,
            choice: {
              kind: s.players[0].lastRaid === s.day - 1 ? "guard" : "raid",
              target: 2,
              recipes: [],
            },
          }
        : simulationAction(s);
    s = dispatch(s, a);
    if (
      s.combat?.done &&
      s.combat.kind === "secret" &&
      s.combat.winner === 0 &&
      s.combat.participants.includes(2)
    )
      break;
  }
  expect(s.players[0].longGoal).toMatchObject({ id: 5, targets: [2] });
  expect(s.combat?.winner).toBe(0);
  // The established focused combat screen hides the common menu until confirmation.
  for (let n = 0; n < 60 && !s.result && s.phase !== "ho"; n++)
    s = dispatch(s, simulationAction(s));
  expect(s.phase).toBe("ho");
  const count = s.combatHistory.filter(
    (c) => c.kind !== "mock" && c.winner === 0 && c.participants.includes(2),
  ).length;
  await page.addInitScript(
    ({ key, json }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, json);
    },
    { key, json: serialize(s) },
  );
  await page.goto("/");
  for (let reload = 0; reload < 2; reload++) {
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    await page.getByRole("button", { name: "課題", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "課題", exact: true });
    await dialog.getByRole("button", { name: "卒業課題", exact: true }).click();
    await expect(dialog).toContainText("ネム");
    await expect(dialog).toContainText(`指定相手への勝利 ${count}回`);
    await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.reload();
  }
});
