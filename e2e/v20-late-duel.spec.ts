import { expect, test } from "@playwright/test";
import {
  V20_NPC_RULES_VERSION,
  V20_RULES_VERSION,
  V21_RULES_VERSION,
} from "../src/domain/config";
import { replay, serialize } from "../src/domain/persistence";
import type { Action, Setup } from "../src/domain/types";
import fixture from "../tests/fixtures/v203-late-duel.json" with { type: "json" };
import { settleScreens } from "./helpers";

for (const [version, key, gain] of [
  [V21_RULES_VERSION, "majoken-save-rules-2.1", 2],
  [V20_RULES_VERSION, "majoken-save-rules-2.0.4", 2],
  [V20_NPC_RULES_VERSION, "majoken-save-rules-2.0.3", 1],
] as const) {
  test(`5日目の公開決闘FP表示と保存・確認・再開 ${version}`, async ({
    page,
  }) => {
    const s = replay(
      fixture.setup as Setup,
      fixture.actionsBeforeWin as Action[],
      version,
    );
    const beforeFp = s.players[0].fp;
    await page.addInitScript(
      ({ key, json }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, json);
      },
      { key, json: serialize(s) },
    );
    await page.goto("/");
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    await settleScreens(page);
    await page
      .getByRole("button", { name: "遊び方・ルール説明", exact: true })
      .click();
    const guide = page.getByRole("dialog", {
      name: "遊び方・ルール説明",
      exact: true,
    });
    await guide.getByText("名声ポイント（FP）", { exact: true }).click();
    if (gain === 2)
      await expect(guide).toContainText("1〜4日目は＋1FP、5〜8日目は＋2FP");
    else await expect(guide).toContainText("公開決闘に勝つと＋1FPです");
    await guide.getByRole("button", { name: "閉じる", exact: true }).click();
    const battle = page.locator(".combat-panel");
    await battle.getByRole("button", { name: "水", exact: true }).click();
    await battle
      .getByRole("button", { name: "属性と薬を確定", exact: true })
      .click();
    await expect(battle.locator(".combat-fp")).toContainText(
      `${beforeFp} → ${beforeFp + gain}`,
    );
    await expect(battle.locator(".combat-fp")).toContainText(`+${gain}`);
    const saved = () => page.evaluate((key) => localStorage.getItem(key), key);
    const afterWin = await saved();
    expect(JSON.parse(afterWin!).state.players[0].fp).toBe(beforeFp + gain);
    await page.reload();
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    await expect(battle.locator(".combat-fp")).toContainText(`+${gain}`);
    expect(await saved()).toBe(afterWin);
    await battle.getByRole("button", { name: "確認した", exact: true }).click();
    const afterAck = await saved();
    expect(JSON.parse(afterAck!).state.players[0].fp).toBe(beforeFp + gain);
    await page.reload();
    await page.getByRole("button", { name: "続きから", exact: true }).click();
    expect(await saved()).toBe(afterAck);
    await settleScreens(page);
    await page.getByRole("button", { name: /決闘（1AP）/ }).click();
    const panel = page.locator(".actions-panel");
    await expect(panel).toContainText(`勝者FP+${gain}`);
    await expect(panel).toContainText(
      "挑戦側・被挑戦側のどちらが勝っても同じFP報酬",
    );
    await expect(panel).toContainText(
      gain === 2 ? "1〜4日目＋1FP／5〜8日目＋2FP" : "全日＋1FP",
    );
    expect(await saved()).toBe(afterAck);
  });
}
