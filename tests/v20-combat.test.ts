import { describe, expect, it } from "vitest";
import { startCombat } from "../src/domain/combat";
import { V20_RULES_VERSION } from "../src/domain/config";
import {
  elementDamage,
  elementLoadout,
  resolveElementRound,
} from "../src/domain/elementCombat";
import { dailyAchieved, longAchieved } from "../src/domain/ho";
import { addItem } from "../src/domain/items";
import { deserialize, serialize } from "../src/domain/persistence";
import { createGame, dispatch } from "../src/domain/reducer";
import type { GameState } from "../src/domain/types";

const game = (seed = "v20-battle-36") =>
  createGame(
    {
      seed,
      name: "アリア",
      magic: "barrier",
      stats: { attack: 3, defense: 3, insight: 3 },
    },
    V20_RULES_VERSION,
  );

function finish(s: GameState) {
  for (let i = 0; i < 5 && !s.combat?.done; i++)
    s = dispatch(s, { type: "elementRound", player: 0, element: "attack" });
  expect(s.combat?.done).toBe(true);
  return s;
}

describe("v2.0 elemental combat", () => {
  it("applies cyclic affinity, level and potion, then caps actual damage at remaining HP for simultaneous KO", () => {
    expect(elementDamage(9, "attack", "insight", true)).toEqual({
      affinity: 1,
      levelBonus: 2,
      potionBonus: 1,
      total: 6,
    });
    expect(elementDamage(6, "insight", "attack", false).total).toBe(2);
    const s = game();
    const c = startCombat(s, 0, 1, "mock");
    c.hp = [2, 1];
    resolveElementRound(s, ["attack", "attack"], [undefined, undefined]);
    expect(c.winner).toBeNull();
    expect(c.hp).toEqual([0, 0]);
    expect(c.elemental?.rounds[0].sides.map((side) => side.dealt)).toEqual([
      1, 2,
    ]);
  });

  it("charges only the challenger and persists loadout, rounds and final confirmation", () => {
    let s = dispatch(game(), { type: "duel", player: 0, target: 1 });
    expect(s.players.map((p) => p.ap).slice(0, 2)).toEqual([1, 2]);
    expect(s.combat?.hp).toEqual([12, 12]);
    expect(() =>
      dispatch(s, { type: "elementRound", player: 0, element: "attack" }),
    ).toThrow();
    s = dispatch(s, { type: "loadout", player: 0, items: [] });
    expect(() =>
      dispatch(s, { type: "loadout", player: 0, items: [] }),
    ).toThrow();
    s = finish(s);
    expect(deserialize(serialize(s))).toEqual(s);
    expect(s.players.reduce((sum, p) => sum + p.fp, 0)).toBe(
      s.combat?.winner === null ? 0 : 1,
    );
    s = dispatch(s, { type: "combatAck", player: 0 });
    expect(s.combat).toBeUndefined();
    expect(s.combatHistory).toHaveLength(1);
    expect(s.phase).toBe("public");
  });

  it("consumes loadout once, rejects mismatched potions, and counts only applied potions for L23", () => {
    const s = game();
    const c = startCombat(s, 0, 1, "public");
    const p = s.players[0];
    const flame = addItem(s, p, "flame");
    const ice = addItem(s, p, "ice");
    const wind = addItem(s, p, "tornado");
    expect(() => elementLoadout(s, p, [flame.id, ice.id, wind.id])).toThrow();
    elementLoadout(s, p, [flame.id, ice.id]);
    elementLoadout(s, s.players[1], []);
    expect(p.inventory.map((item) => item.id)).not.toContain(ice.id);
    expect(() =>
      resolveElementRound(s, ["defense", "attack"], [flame.id, undefined]),
    ).toThrow();
    expect(c.elemental?.rounds).toHaveLength(0);
    c.hp = [5, 1];
    resolveElementRound(s, ["attack", "attack"], [flame.id, undefined]);
    expect(c.elemental?.rounds[0].sides[0]).toMatchObject({
      calculated: 3,
      dealt: 1,
      potionBonus: 1,
    });
    expect(c.brought[0].map((item) => item.id)).toEqual([ice.id]);
    expect(
      s.logs.filter((log) => log.type === "usePotion").map((log) => log.kind),
    ).toEqual(["flame"]);
    s.combatHistory.push(c);
    s.logs.push({
      ...s.logs.at(-1)!,
      actor: 0,
      type: "combat",
      data: { id: c.id },
    });
    expect(dailyAchieved(s, p, { id: 21, targets: [], achieved: false })).toBe(
      true,
    );
    expect(longAchieved(s, p, { id: 23, targets: [], achieved: false })).toBe(
      false,
    );
  });

  it.each([
    ["v20-battle-36", 4],
    ["v20-battle-6", 10],
  ] as const)(
    "plays mock combat with no AP, combat FP or potion use (%s)",
    (seed, event) => {
      let s = game(seed);
      expect(s.event.id).toBe(event);
      if (event === 10) {
        const items = Array.from(
          { length: 8 },
          () => addItem(s, s.players[0], "sand").id,
        );
        s = dispatch(s, { type: "reserve", player: 0, items, stats: {} });
      }
      s = dispatch(s, { type: "duel", player: 0, target: 1, mock: true });
      expect(s.players[0].ap).toBe(2);
      expect(() =>
        dispatch(s, { type: "loadout", player: 0, items: [] }),
      ).toThrow();
      s = finish(s);
      expect(s.event.mock).toEqual([0, 1]);
      expect(s.players[0].fp).toBe(0);
      expect(s.logs.some((log) => log.type === "win")).toBe(false);
      expect(s.logs.some((log) => log.type === "usePotion")).toBe(false);
      s = dispatch(s, { type: "combatAck", player: 0 });
      expect(() =>
        dispatch(s, { type: "duel", player: 0, target: 2, mock: true }),
      ).toThrow();
      s.publicTurn.round = 4;
      const sizes = s.players.slice(0, 2).map((p) => p.inventory.length);
      s = dispatch(s, { type: "advance" });
      expect(s.event.success).toBe(true);
      expect(s.players[0].inventory).toHaveLength(
        sizes[0] + 2 - (event === 10 ? 8 : 0),
      );
      expect(s.players[1].inventory).toHaveLength(sizes[1] + 2);
      expect(s.players[0].fp).toBe(event === 10 ? 1 : 0);
    },
  );
});
