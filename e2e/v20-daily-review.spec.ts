import { expect, test } from "@playwright/test";
import { createGame, dispatch } from "../src/domain/reducer";
import { simulationAction } from "../src/domain/simulation";
import { serialize } from "../src/domain/persistence";
import { V20_RULES_VERSION } from "../src/domain/config";
import { dailyReview } from "../src/ui/dailyReview";
import { graduationProgress } from "../src/ui/graduationProgress";
import { settleScreens } from "./helpers";
const key = "majoken-save-rules-2.0.3";
function noDuelNight() {
  for (let seed = 0; seed < 30; seed++) {
    let s = createGame(
      {
        name: "アリア",
        seed: `summary-${seed}`,
        magic: "barrier",
        stats: { attack: 3, defense: 3, insight: 3 },
      },
      V20_RULES_VERSION,
    );
    for (let i = 0; i < 60 && !s.result && s.phase !== "night"; i++)
      s = dispatch(s, simulationAction(s));
    if (s.phase !== "night") continue;
    const after = dispatch(
      dispatch(s, {
        type: "night",
        player: 0,
        choice: { kind: "rest", target: 1, recipes: [] },
      }),
      { type: "advance" },
    );
    if (after.phase === "ho" && !after.combat) return { before: s, after };
  }
  throw Error("No valid non-participant fixture");
}
for (const width of [1440, 390]) {
  test(`当事者外の決闘画面を省略して同日のまとめで停止・再開 ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const { before, after } = noDuelNight();
    await page.addInitScript(
      ({ key, json }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, json);
      },
      { key, json: serialize(before) },
    );
    await page.goto("/");
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    await page.getByRole("button", { name: "休息", exact: true }).click();
    await page.getByRole("button", { name: "夜間行動と錬金を確定" }).click();
    await expect(page.locator(".combat-panel")).toHaveCount(0);
    await expect(page.locator(".action-result")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "課題判定・夜明け", exact: true }),
    ).toBeVisible();
    expect(
      JSON.parse(
        (await page.evaluate((key) => localStorage.getItem(key), key))!,
      ).state,
    ).toEqual(JSON.parse(JSON.stringify(after)));
    await page.getByRole("button", { name: /課題を判定して夜明けへ/ }).click();
    const summary = page.getByRole("region", {
      name: "夜明けのまとめ",
      exact: true,
    });
    await expect(summary).toHaveCount(1);
    await expect(
      summary.getByRole("region", { name: "課題判定", exact: true }),
    ).toContainText("卒業課題");
    const saved = await page.evaluate((key) => localStorage.getItem(key), key);
    const state = JSON.parse(saved!).state;
    const expected = dailyReview(state);
    for (const line of graduationProgress(state))
      await expect(summary).toContainText(line);
    await expect(summary).toContainText(
      `本日の合計：${expected.fpEnd - expected.fpStart > 0 ? "+" : ""}${expected.fpEnd - expected.fpStart} FP`,
    );
    await expect(summary).toContainText("公開行動");
    await expect(summary.getByRole("button", { name: /次の日へ/ })).toHaveCount(
      1,
    );
    expect(await summary.evaluate((el) => getComputedStyle(el).textAlign)).toBe(
      "left",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("daily-summary.png"),
      fullPage: true,
    });
    await page.reload();
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    await expect(summary).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      saved,
    );
    // Only own/private-authorized entries may reach the summary.
    await page.evaluate(async () => {
      const { useGameStore } = await new Function(
        "return import('/src/stores/game.ts')",
      )();
      const store = useGameStore();
      const s = structuredClone(store.state);
      s.logs.push({
        seq: s.logs.length + 1,
        day: s.day,
        phase: "night",
        type: "nightChoice",
        actor: 1,
        target: 0,
        kind: "curse",
        audience: [1],
        text: "他者専用の秘匿行動",
      });
      s.logs.push({
        seq: s.logs.length + 1,
        day: s.day,
        phase: "ho",
        type: "fp",
        actor: 1,
        amount: -1,
        kind: "ho",
        audience: [1],
        text: "他者専用の課題",
      });
      store.state = s;
    });
    await expect(summary).not.toContainText("他者専用");
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      saved,
    );
    // Restore the validated save before continuing.
    await page.reload();
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    await summary.getByRole("button", { name: /次の日へ/ }).click();
    await expect(summary).toHaveCount(0);
    const next = await page.evaluate((key) => localStorage.getItem(key), key);
    await page.reload();
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    await expect(summary).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      next,
    );
  });
}

test("通常薬は選択中の採集・研究・購買だけに表示する", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /ゲーム開始/ }).click();
  await page.getByRole("button", { name: "研究開始", exact: true }).click();
  await settleScreens(page);
  await page.evaluate(async () => {
    const { useGameStore } = await new Function(
      "return import('/src/stores/game.ts')",
    )();
    const store = useGameStore();
    const s = structuredClone(store.state);
    for (const kind of ["abundance", "scholarship", "bargaining"])
      s.players[0].inventory.push({ id: s.nextItem++, kind });
    s.players[0].inventory.push({
      id: s.nextItem++,
      kind: "scholarship",
      usableDay: s.day + 1,
    });
    store.state = s;
  });
  await expect(
    page.getByRole("button", { name: /の薬を使う（0AP）/ }),
  ).toHaveCount(0);
  for (const [action, potion] of [
    ["採集", "豊穣"],
    ["研究", "研鑽"],
    ["購買部", "交渉"],
  ]) {
    await page
      .getByRole("button", { name: `${action}（1AP）`, exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: `${potion}の薬を使う（0AP）`,
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: /の薬を使う（0AP）/ }),
    ).toHaveCount(1);
    await page
      .getByRole("button", { name: "キャンセルして戻る", exact: true })
      .click();
  }
  await page.getByRole("button", { name: "納品（0AP）", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /の薬を使う（0AP）/ }),
  ).toHaveCount(0);
});
