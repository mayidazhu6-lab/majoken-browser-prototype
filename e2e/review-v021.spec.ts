import { test, expect, type Page } from "@playwright/test";
import { createGame, dispatch, currentPlayer } from "../src/domain/reducer";
import { simulationAction } from "../src/domain/simulation";
import { chooseStance } from "../src/domain/combat";
import { materialIds, canRecipe, available } from "../src/domain/items";
import { dailyProgress } from "../src/domain/ho";
import { donationItems } from "../src/domain/events";
import { serialize } from "../src/domain/persistence";
import type { Action, GameState } from "../src/domain/types";
const setup = {
  name: "アリア",
  seed: "moon-42",
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
    name: "review.json",
    mimeType: "application/json",
    buffer: Buffer.from(serialize(s)),
  });
  await expect(page.locator(".alert.error")).toHaveCount(0);
}
function potionFixture() {
  let s = createGame({
    ...setup,
    seed: "potion-review-1",
    stats: { attack: 2, defense: 2, insight: 6 },
  });
  for (let n = 0; s.phase !== "ended" && n < 500; n++) {
    const p = s.players[0];
    let a = simulationAction(s);
    if (s.combat && !s.combat.done) {
      const c = s.combat,
        side = c.participants.indexOf(0),
        q = s.players[c.participants[1 - side]];
      a = {
        type: "round",
        player: 0,
        stance: chooseStance(
          p.stats,
          q.stats,
          c.charge[side],
          c.charge[1 - side],
          c.previous[side],
          [c.hp[side], c.hp[1 - side]],
          [],
          5 - c.rounds.length,
        ),
      };
    }
    if (
      s.phase === "public" &&
      !s.combat &&
      !s.challenge &&
      !s.trades.length &&
      currentPlayer(s) === 0 &&
      s.publicTurn.round < 4 &&
      !p.pendingRecipe
    ) {
      const potion = available(p).find((i) => i.kind === "strike"),
        target = s.players.find((q) => q.ai && q.stats.insight < 9);
      if (
        potion &&
        target &&
        !p.commands.length &&
        p.ap === 2 &&
        !s.publicTurn.acted &&
        s.publicTurn.round === 1
      ) {
        s = dispatch(s, {
          type: "trade",
          player: 0,
          target: target.id,
          offer: [potion.id],
          request: {},
        });
        return {
          s: dispatch(s, { type: "duel", player: 0, target: target.id }),
          target: target.id,
          item: potion.id,
        };
      }
      a =
        s.publicTurn.round < 3 && !s.publicTurn.acted && p.ap > 0
          ? p.commands.length
            ? { type: "forced", player: 0, kind: "gather" }
            : p.stats.insight < 9 && materialIds(p, ["water", "dew"])
              ? { type: "research", player: 0, stat: "insight" }
              : { type: "gather", player: 0 }
          : { type: "endTurn", player: 0 };
    }
    if (s.phase === "night" && !p.night)
      a =
        canRecipe(p, "strike", s.day) && materialIds(p, ["obsidian", "crystal"])
          ? {
              type: "night",
              player: 0,
              choice: { kind: "brew", recipes: ["strike"] },
            }
          : { type: "night", player: 0, choice: { kind: "rest" } };
    s = dispatch(s, a);
  }
  throw Error("合法な操作列から戦闘薬譲渡の局面に到達できませんでした");
}

test("Lv3未満のAIへ戦闘薬を譲渡しても不正持込せず、人間との戦闘が進行する", async ({
  page,
}) => {
  const { s, target, item } = potionFixture();
  expect(s.players[target].stats.insight).toBeLessThan(9);
  expect(s.players[target].inventory.some((i) => i.id === item)).toBe(true);
  await page.goto("/");
  await load(page, s);
  for (let n = 0; n < 5; n++) {
    const before = await state(page);
    if (!before.combat || before.combat.done) break;
    await page
      .locator(".stance-options")
      .getByRole("button", { name: "攻撃", exact: true })
      .click();
    await page.getByRole("button", { name: /手を確定/ }).click();
    await expect(page.locator(".alert.error")).toHaveCount(0);
  }
  const after = await state(page),
    c = after.combatHistory.at(-1)!;
  expect(c.done).toBe(true);
  expect(c.participants).toEqual([0, target]);
  expect(c.rounds.every((r) => r.potions[1] === null)).toBe(true);
  expect(after.players[target].inventory.some((i) => i.id === item)).toBe(true);
});

test("攻撃vsためるのUI被ダメージは左右とも攻撃判定値−3・最低1", async ({
  page,
}) => {
  let s = createGame({ ...setup, seed: "witches-2026" });
  const seen = new Set<number>();
  await page.goto("/");
  for (let n = 0; s.phase !== "ended" && n < 500 && seen.size < 2; n++) {
    const c = s.combat;
    if (c?.kind === "secret" && c.done && !c.resultAcknowledged) {
      await load(page, s);
      const dialog = page.getByRole("dialog", { name: "秘匿決闘の結果" });
      for (const [index, r] of c.rounds.entries()) {
        for (const side of [0, 1])
          if (
            r.choices[side] === "charge" &&
            r.choices[1 - side] === "attack"
          ) {
            const expected = Math.max(1, r.values[1 - side] - 3);
            expect(r.damage[side]).toBe(expected);
            await expect(
              dialog
                .locator(`tbody tr`)
                .nth(index)
                .locator(`td[data-side="${side}"]`),
            ).toContainText(`被ダメージ ${expected}`);
            seen.add(side);
          }
      }
      await dialog.getByRole("button", { name: "OK", exact: true }).click();
    }
    s = dispatch(s, simulationAction(s));
  }
  expect([...seen].sort()).toEqual([0, 1]);
});

test("研究所崩壊で最終判定されなかった日次HOは判定なし・報酬なしと表示", async ({
  page,
}) => {
  let s = createGame({ ...setup, seed: "collapse-ui-298" }),
    before = s;
  for (let n = 0; s.phase !== "ended" && n < 500; n++) {
    before = s;
    const p = s.players[0];
    let a: Action = simulationAction(s);
    if (
      s.phase === "public" &&
      !s.combat &&
      !s.challenge &&
      !s.trades.length &&
      currentPlayer(s) === 0 &&
      s.publicTurn.round < 4 &&
      !p.pendingRecipe
    )
      a =
        p.commands.length && !s.publicTurn.acted
          ? { type: "forced", player: 0, kind: "gather" }
          : { type: "endTurn", player: 0 };
    if (s.phase === "night" && !p.night)
      a = { type: "night", player: 0, choice: { kind: "rest" } };
    s = dispatch(s, a);
  }
  expect(s.result?.reason).toBe("collapse");
  expect(dailyProgress(before, before.players[0]).status).toBe("達成見込み");
  await page.goto("/");
  await load(page, before);
  await expect(page.locator(".daily-ho-progress")).toContainText("達成見込み");
  await page
    .getByRole("dialog", { name: "取引への返答が必要です" })
    .getByRole("button", { name: "受諾", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "共通イベントの結果" })
    .getByRole("button", { name: "OK", exact: true })
    .click();
  await expect(page.locator(".final-results")).toBeVisible();
  await expect(page.locator(".final-results")).toContainText("卒業者なし");
  await expect(page.locator(".daily-ho-progress")).toContainText(
    "判定なし・報酬なし",
  );
  expect((await state(page)).players[0].fp).toBe(before.players[0].fp);
  expect(
    (await state(page)).players[0].dailyHistory.some((h) => h.day === s.day),
  ).toBe(false);
  await page.reload();
  await page.getByRole("button", { name: "続きから", exact: true }).click();
  await expect(page.locator(".daily-ho-progress")).toContainText(
    "判定なし・報酬なし",
  );
});

test("二択イベントは未確定の素材予約を進捗に数え、ルート確定・取消で更新", async ({
  page,
}) => {
  let s = createGame({ ...setup, seed: "either-ui-83" });
  expect(s.event.id).toBe(12);
  expect(s.players[0].dailyGoal.id).toBe(7);
  s = dispatch(s, {
    type: "reserve",
    player: 0,
    items: [s.players[0].inventory[0].id],
    stats: {},
  });
  expect(s.event.route).toBeUndefined();
  await page.goto("/");
  await load(page, s);
  await expect(page.locator(".daily-ho-progress")).toHaveText(/未達成.*1\/1/);
  await expect(page.locator(".daily-ho-progress")).not.toContainText(
    "達成見込み",
  );
  s = dispatch(s, { type: "gather", player: 0 });
  s = dispatch(s, { type: "endTurn", player: 0 });
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
  s = dispatch(s, {
    type: "reserve",
    player: 0,
    items: donationItems(s, s.players[0]),
    stats: {},
  });
  expect(s.event.route).toBe("materials");
  await load(page, s);
  await expect(page.locator(".daily-ho-progress")).toContainText("達成見込み");
  s = dispatch(s, { type: "withdraw", player: 0 });
  expect(s.event.route).toBeUndefined();
  await load(page, s);
  await expect(page.locator(".daily-ho-progress")).toHaveText(/未達成.*0\/1/);
  expect(s.players[0].dailyGoal.achieved).toBe(false);
});
