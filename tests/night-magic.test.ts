import { describe, it, expect } from "vitest";
import { createGame, dispatch } from "../src/domain/reducer";
import { addItem, canRecipe } from "../src/domain/items";
import { startCombat, resolveRound } from "../src/domain/combat";
import { dailyAchieved } from "../src/domain/ho";
import type { GameState, Magic } from "../src/domain/types";
const game = (magic: Magic = "barrier") => {
  const s = createGame({
    name: "夜の魔女",
    seed: "night",
    magic,
    stats: { attack: 4, defense: 3, insight: 3 },
  });
  for (const p of s.players.slice(1)) p.availableDay = 99;
  return s;
};
function resolveNight(s: GameState) {
  let i = 0;
  while (s.phase !== "ho" && s.phase !== "ended" && i++ < 50) {
    if (s.combat) {
      if (s.combat.done)
        s = dispatch(s, { type: "reward", player: 0, kind: "item" });
      else s = dispatch(s, { type: "round", player: 0, stance: "defend" });
    } else s = dispatch(s, { type: "advance" });
  }
  return s;
}
describe("魔法5種・秘匿6行動の統合", () => {
  it("予知：候補共有・投票・CD・第8日不可", () => {
    let s = game("foresight");
    s.phase = "magic";
    s = dispatch(s, { type: "magic", player: 0 });
    expect(new Set(s.foresight).size).toBe(3);
    expect(s.players[0].availableDay).toBe(4);
    expect(() => dispatch(s, { type: "magic", player: 0 })).toThrow();
    s = dispatch(s, { type: "advance" });
    const id = s.foresight[1];
    s = dispatch(s, { type: "vote", player: 0, event: id });
    s = dispatch(s, { type: "advance" });
    expect(s.nextEvent).toBe(id);
    expect(s.usedEvents).not.toContain(id);
    const late = game("foresight");
    late.phase = "magic";
    late.day = 8;
    expect(() => dispatch(late, { type: "magic", player: 0 })).toThrow("第8日");
  });
  it("結界：他者を保護し呪詛・襲撃・偵察を遮断", () => {
    for (const kind of ["curse", "raid", "scout"] as const) {
      let s = game("barrier");
      s.phase = "magic";
      s = dispatch(s, { type: "magic", player: 0, target: 1 });
      s = dispatch(s, { type: "advance" });
      s.players.forEach((p) => (p.night = { kind: "rest" }));
      s.players[0].night = undefined;
      s = dispatch(s, {
        type: "night",
        player: 0,
        choice: { kind, target: 1 },
      });
      s = resolveNight(s);
      expect(s.combatHistory.filter((c) => c.kind === "secret")).toHaveLength(
        0,
      );
      expect(s.logs.some((l) => l.type === "curseHit" && l.actor === 0)).toBe(
        false,
      );
      expect(
        s.logs.some(
          (l) => l.type === "scout" && l.actor === 0 && (l.amount ?? 0) > 0,
        ),
      ).toBe(false);
    }
  });
  it("影渡り：偵察3個確認、呪詛対象にもFP減点", () => {
    for (const kind of ["rest", "curse"] as const) {
      let s = game("shadow");
      s.phase = "magic";
      s = dispatch(s, { type: "magic", player: 0 });
      s = dispatch(s, { type: "advance" });
      s.players.forEach((p) => (p.night = { kind: "rest" }));
      s.players[1].night = { kind, target: 2 };
      s.players[1].fp = 2;
      s.players[0].night = undefined;
      s = dispatch(s, {
        type: "night",
        player: 0,
        choice: { kind: "scout", target: 1 },
      });
      s = resolveNight(s);
      if (kind === "rest")
        expect(
          s.logs.find((l) => l.type === "scout" && l.actor === 0)?.amount,
        ).toBe(3);
      else expect(s.players[1].fp).toBe(1);
    }
  });
  it("秘伝錬成：未解放レシピは翌公開のみ、CD2", () => {
    let s = game("alchemy");
    s.phase = "magic";
    s = dispatch(s, { type: "magic", player: 0 });
    const p = s.players[0],
      r = p.temporaryRecipe!;
    expect(r.day).toBe(2);
    expect(canRecipe(p, r.kind, 1)).toBe(false);
    expect(canRecipe(p, r.kind, 2)).toBe(true);
    expect(canRecipe(p, r.kind, 3)).toBe(false);
    expect(p.availableDay).toBe(3);
  });
  it("幻惑：襲撃の1Rだけ手変更、元の手をHO用に保存", () => {
    const s = game("illusion");
    s.players[0].activeMagic = true;
    const c = startCombat(s, 0, 1, "secret");
    c.illusionRound = 0;
    resolveRound(s, ["defend", "defend"], [undefined, undefined]);
    expect(c.rounds[0].original).toEqual(["defend", "defend"]);
    expect(c.rounds[0].choices[1]).not.toBe("defend");
    expect(c.rounds[0].choices[0]).toBe("defend");
  });
  it("夜錬金は0APで1個だけ、確定後の変更不可", () => {
    let s = game();
    s.phase = "night";
    s.players.forEach((p) => (p.night = { kind: "rest" }));
    s.players[0].night = undefined;
    addItem(s, s.players[0], "crystal");
    const ap = s.players[0].ap;
    s = dispatch(s, {
      type: "night",
      player: 0,
      choice: { kind: "brew", recipe: "vigor" },
    });
    expect(() =>
      dispatch(s, { type: "night", player: 0, choice: { kind: "rest" } }),
    ).toThrow();
    s = resolveNight(s);
    expect(s.players[0].ap).toBe(ap);
    expect(
      s.logs.filter((l) => l.type === "brew" && l.actor === 0),
    ).toHaveLength(1);
  });
  it("呪詛はLv分・非重複、浄化薬は複数命中に1個消費", () => {
    let s = game();
    s.phase = "night";
    s.players[0].stats.attack = 9;
    s.players[0].night = { kind: "curse", target: 1 };
    s.players[2].night = { kind: "curse", target: 1 };
    s.players[1].night = { kind: "guard" };
    s.players[3].night = { kind: "rest" };
    addItem(s, s.players[1], "cleanse");
    addItem(s, s.players[1], "cleanse");
    s = resolveNight(s);
    expect(s.players[1].curse).toBe(0);
    expect(
      s.players[1].inventory.filter((i) => i.kind === "cleanse"),
    ).toHaveLength(1);
    expect(s.logs.filter((l) => l.type === "curseHit")).toHaveLength(2);
  });
  it("休息：Lv2は翌公開の全行動+2、敗北／引分は不発", () => {
    let s = game();
    s.phase = "night";
    s.players.forEach((p) => (p.night = { kind: "rest" }));
    s.players[0].stats.defense = 6;
    s = resolveNight(s);
    expect(s.players[0].rest).toBe(2);
    expect(
      dailyAchieved(s, s.players[0], { id: 15, targets: [], achieved: false }),
    ).toBe(true);
  });
  it("翌日の強制APは最大2、本人が採集か錬金を選ぶ", () => {
    let s = game();
    s.phase = "dawn";
    s.players[0].commands = [{ from: 1 }, { from: 2 }, { from: 3 }];
    s = dispatch(s, { type: "advance" });
    expect(s.players[0].commands).toHaveLength(2);
    expect(() => dispatch(s, { type: "gather", player: 0 })).toThrow("命令");
    s = dispatch(s, { type: "forced", player: 0, kind: "gather" });
    addItem(s, s.players[0], "crystal");
    s = dispatch(s, {
      type: "forced",
      player: 0,
      kind: "brew",
      recipe: "vigor",
    });
    expect(s.players[0].commands).toHaveLength(0);
    expect(s.players[0].ap).toBe(0);
    expect(s.logs.filter((l) => l.type === "commandExecuted")).toHaveLength(2);
  });
  it("人間の降参は素材2個を渡し、決闘・FP・勝利HOを発生させない", () => {
    let s = game();
    s = dispatch(s, { type: "duel", player: 1, target: 0 });
    expect(s.challenge).toBeDefined();
    const ids = s.players[0].inventory.slice(0, 2).map((i) => i.id);
    s = dispatch(s, {
      type: "challengeReply",
      player: 0,
      fight: false,
      items: ids,
    });
    expect(s.challenge).toBeUndefined();
    expect(s.combatHistory).toHaveLength(0);
    expect(s.players[1].fp).toBe(0);
    expect(s.players[1].ap).toBe(0);
    expect(
      ids.every((id) => s.players[1].inventory.some((i) => i.id === id)),
    ).toBe(true);
  });
});
