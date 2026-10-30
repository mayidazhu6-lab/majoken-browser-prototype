import { test, expect, type Page } from "@playwright/test";
import { createGame, dispatch, currentPlayer } from "../src/domain/reducer";
import { simulationAction, simulate } from "../src/domain/simulation";
import { serialize } from "../src/domain/persistence";
import { available, isMaterial } from "../src/domain/items";
import { selectItems } from "./helpers";
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
    name: "v022.json",
    mimeType: "application/json",
    buffer: Buffer.from(serialize(s)),
  });
  await expect(page.locator(".alert.error")).toHaveCount(0);
}
function checkpoint(
  predicate: (s: GameState) => boolean,
  seeds = ["witches-2026", "lab-77", "moon-42"],
) {
  for (const seed of seeds) {
    let s = createGame({ ...setup, seed });
    for (let n = 0; s.phase !== "ended" && n < 500; n++) {
      if (predicate(s)) return s;
      s = dispatch(s, simulationAction(s));
    }
  }
  throw Error("合法な操作列でチェックポイントに到達できませんでした");
}
test("ためる確定後は次Rの選択を解除し、連続・第5RのためるをUIでも禁止", async ({
  page,
}) => {
  let s = createGame({
    ...setup,
    seed: "reward-5",
    stats: { attack: 2, defense: 2, insight: 6 },
  });
  await page.goto("/");
  await load(page, s);
  await page.getByRole("button", { name: "決闘", exact: true }).click();
  await page.getByRole("button", { name: "公開決闘 1AP", exact: true }).click();
  expect((await state(page)).players[0].ap).toBe(1);

  const charge = page
    .locator(".stance-options")
    .getByRole("button", { name: "ためる", exact: true });
  await charge.click();
  await page.getByRole("button", { name: /手を確定/ }).click();
  await expect(charge).toBeDisabled();
  await expect(charge).not.toHaveClass(/chosen/);
  for (let i = 1; i < 4; i++) {
    await page
      .locator(".stance-options")
      .getByRole("button", { name: "防御", exact: true })
      .click();
    await page.getByRole("button", { name: /手を確定/ }).click();
  }
  await expect(charge).toBeDisabled();
  await expect(page.locator(".combat-panel")).toContainText(
    "第5ラウンドです。ためるは選択できません",
  );
  await page.getByRole("button", { name: /手を確定/ }).click();
  const dialog = page.getByRole("dialog", { name: "公開決闘の結果" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("能力移転はありません");
  await expect(page.locator(".event-panel .event-metrics")).toBeVisible(); // Requirements remain available during a public duel.
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  expect((await state(page)).players[0].ap).toBe(1);
});
test("連夜の襲撃は選択でき、確定後に操作できない理由が表示される", async ({
  page,
}) => {
  let s = createGame(setup);
  for (let n = 0; n < 500; n++) {
    if (
      s.phase === "night" &&
      !s.players[0].night &&
      s.players[0].lastRaid === s.day - 1
    )
      break;
    const a =
      s.phase === "night" && !s.players[0].night
        ? {
            type: "night" as const,
            player: 0,
            choice: { kind: "raid" as const, target: 1 },
          }
        : simulationAction(s);
    s = dispatch(s, a);
  }
  expect(s.phase).toBe("night");
  expect(s.players[0].lastRaid).toBe(s.day - 1);
  await page.goto("/");
  await load(page, s);
  const raid = page
    .locator(".night-options")
    .getByRole("button", { name: "襲撃", exact: true });
  await expect(raid).toBeEnabled();
  await raid.click();
  await page
    .getByRole("button", { name: "秘匿行動を確定", exact: true })
    .click();
  await expect(raid).toBeDisabled();
  await expect(
    page.getByText("この夜の行動は確定済みです。別の行動は選択できません。", {
      exact: true,
    }),
  ).toBeVisible();
  expect((await state(page)).players[0].night?.kind).toBe("raid");
});
test("2巡終了で納品自動確定、イベント結果をOKまで維持し保存再開できる", async ({
  page,
}) => {
  const s = checkpoint((s) => {
    const a = simulationAction(s);
    return a.type === "endTurn" && dispatch(s, a).event.resolved;
  });
  expect(s.phase).toBe("public");
  await page.goto("/");
  await load(page, s);
  await expect(
    page.getByRole("button", { name: /最終納品|納品確定/ }),
  ).toHaveCount(0);
  await page.locator(".progression button.primary").click();
  const after = await state(page);
  expect(after.event.resolved).toBe(true);
  expect(after.event.acknowledged).not.toBe(true);
  const dialog = page.getByRole("dialog", { name: "共通イベントの結果" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("最終納品");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  expect((await state(page)).event.acknowledged).toBe(true);
  const precedes = await page
    .locator(".progression")
    .evaluate(
      (el) =>
        !!(
          el.compareDocumentPosition(document.querySelector(".journal")!) &
          Node.DOCUMENT_POSITION_FOLLOWING
        ),
    );
  expect(precedes).toBe(true);
});
test("購買部は個体IDを表示せず種類別数量で3素材を選択し1AP交換する", async ({
  page,
}) => {
  const s = createGame({ ...setup, seed: "shop-ui-022" });
  await page.goto("/");
  await load(page, s);
  await page.getByRole("button", { name: "取引", exact: true }).click();
  await expect(page.locator(".actions-panel")).not.toContainText(/#\d+/);
  const quantity = page.locator(".grouped-items input").first();
  await quantity.fill("999");
  await expect(quantity).toHaveValue("0");
  await selectItems(
    page,
    s,
    s.players[0].inventory.map((i) => i.id),
  );
  await page.getByRole("button", { name: "3個を交換", exact: true }).click();
  const after = await state(page);
  expect(after.players[0].ap).toBe(1);
  expect(after.players[0].inventory).toHaveLength(1);
});
test("強制行動の採集・研究はPCと狭い画面で重ならず1AP実行できる", async ({
  page,
}) => {
  const s = checkpoint(
    (s) =>
      s.phase === "public" &&
      currentPlayer(s) === 0 &&
      !s.publicTurn.acted &&
      s.players[0].commands.length > 0 &&
      !s.combat &&
      !s.challenge &&
      !s.trades.length,
  );
  await page.goto("/");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await load(page, s);
    const panel = page.locator(".forced-panel");
    await expect(panel).toBeVisible();
    const boxes = await panel.locator("button,select").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i]!;
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w).toBeLessThanOrEqual(width);
      for (let j = i + 1; j < boxes.length; j++) {
        const b = boxes[j]!;
        expect(
          a.x >= b.x + b.w ||
            b.x >= a.x + a.w ||
            a.y >= b.y + b.h ||
            b.y >= a.y + a.h,
        ).toBe(true);
      }
    }
    await panel.screenshot({ path: `/tmp/v022-forced-${width}.png` });
  }
  await page
    .getByRole("button", { name: "命令の採集を実行", exact: true })
    .click();
  expect((await state(page)).players[0].ap).toBe(s.players[0].ap - 1);
});
test("公開決闘の降参は譲渡品とFPなしを確認してから復帰する", async ({
  page,
}) => {
  const s = checkpoint(
    (s) =>
      !!s.challenge &&
      !s.challenge.mock &&
      available(s.players[0]).filter((i) => isMaterial(i.kind)).length >= 2,
  );
  await page.goto("/");
  await load(page, s);
  await expect(page.locator(".event-panel")).toBeVisible();
  await selectItems(
    page,
    s,
    available(s.players[0])
      .filter((i) => isMaterial(i.kind))
      .slice(0, 2)
      .map((i) => i.id),
  );
  await page
    .getByRole("button", { name: "素材2個 / 薬1個で降参", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "公開決闘の結果" });
  await expect(dialog).toContainText("双方FP増加なし");
  const before = await state(page);
  await page.reload();
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(await state(page)).toEqual(before);
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
test("最終結果は卒業者だけに順位を付け、未卒業・卒業者なしを明示する", async ({
  page,
}) => {
  await page.goto("/");
  for (const seed of ["lab-77", "review-1"]) {
    const s = simulate(seed);
    await load(page, s);
    for (const r of s.result!.ranking) {
      const row = page.locator(".final-results tbody tr").filter({
        has: page.getByRole("cell", {
          name: s.players[r.player].name,
          exact: true,
        }),
      });
      await expect(row).toContainText(r.graduated ? `${r.rank}位` : "未卒業");
      if (!r.graduated) await expect(row).toContainText("順位なし");
    }
    if (!s.result!.graduates.length)
      await expect(page.locator(".final-results")).toContainText("卒業者なし");
  }
});

test("通常行動でAP0になった後も0APの魔女間取引を申請できる", async ({
  page,
}) => {
  let s = checkpoint(
    (s) =>
      s.phase === "public" &&
      currentPlayer(s) === 0 &&
      s.publicTurn.round === 2 &&
      !s.publicTurn.acted &&
      s.players[0].ap === 1 &&
      !s.players[0].commands.length &&
      !s.players[0].pendingRecipe &&
      !s.combat &&
      !s.challenge &&
      !s.trades.length,
  );
  s = dispatch(s, { type: "gather", player: 0 });
  expect(s.players[0].ap).toBe(0);
  await page.goto("/");
  await load(page, s);
  await page.getByRole("button", { name: "取引", exact: true }).click();
  await page.getByText("提供と要求の個数を入力", { exact: true }).click();
  const item = available(s.players[0])[0]!;
  const label =
    (await import("../src/domain/config")).LABELS[item.kind] ??
    (await import("../src/domain/items")).recipe(item.kind)?.name ??
    item.kind;
  await page.getByLabel(`${label} 提供数`, { exact: true }).fill("1");
  const button = page.getByRole("button", {
    name: "固定条件で提案",
    exact: true,
  });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.locator(".alert.error")).toHaveCount(0);
  expect((await state(page)).players[0].ap).toBe(0);
});
