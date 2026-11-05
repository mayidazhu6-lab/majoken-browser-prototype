import { expect, it } from "vitest";
import { V20_GOALS_RULES_VERSION } from "../src/domain/config";
import { addItem } from "../src/domain/items";
import {
  chooseNight,
  finishNight,
  registerNight,
  unlockNightRecipes,
} from "../src/domain/night";
import { deserialize, serialize } from "../src/domain/persistence";
import { createGame, dispatch } from "../src/domain/reducer";
import type { Action } from "../src/domain/types";

const create = (seed = "night-1") =>
  createGame(
    {
      name: "アリア",
      seed,
      magic: "barrier",
      stats: { attack: 3, defense: 3, insight: 3 },
    },
    V20_GOALS_RULES_VERSION,
  );

it("resumes the locked round and pending reward without repeating HP, items or results", () => {
  let s = create();
  const act = (action: Action) => {
    s = dispatch(s, action);
  };
  const reload = () => {
    s = deserialize(serialize(s));
  };
  for (let i = 0; i < 2; i++) {
    act({ type: "gather", player: 0 });
    act({ type: "endTurn", player: 0 });
  }
  act({ type: "eventAck", player: 0 });
  act({ type: "advance" });
  if (s.phase === "vote") {
    act({ type: "vote", player: 0, event: s.foresight[0] });
    act({ type: "advance" });
  }
  act({ type: "night", player: 0, choice: { kind: "raid", target: 2 } });
  reload();
  act({ type: "advance" });
  expect(s.combat?.kind).toBe("secret");
  act({ type: "loadout", player: 0, items: [] });
  for (let i = 0; i < 5 && !s.combat?.done; i++) {
    const before = [...s.combat!.hp];
    act({ type: "elementRound", player: 0, element: "defense" });
    reload();
    expect(s.combat?.hp).toEqual(before);
    expect(s.combat?.elemental?.pending?.element).toBe("defense");
    expect(() =>
      dispatch(s, { type: "elementRound", player: 0, element: "attack" }),
    ).toThrow();
    act({ type: "elementReply", player: 0 });
    expect(s.combat?.elemental?.rounds).toHaveLength(i + 1);
    expect(
      s.logs
        .filter((l) => l.type === "combatRound")
        .every((l) => l.audience !== "public"),
    ).toBe(true);
  }
  act({ type: "combatAck", player: 0 });
  expect(s.phase).toBe("rewards");
  reload();
  let commanded = dispatch(s, {
    type: "nightReward",
    player: 0,
    command: "gather",
  });
  commanded = deserialize(serialize(commanded));
  expect(commanded.players[2].commands).toHaveLength(1);
  commanded = dispatch(commanded, { type: "advance" });
  commanded = dispatch(commanded, { type: "advance" });
  expect(commanded.day).toBe(2);
  expect(
    commanded.logs.filter(
      (l) => l.day === 2 && l.type === "commandExecuted" && l.target === 2,
    ),
  ).toHaveLength(1);
  expect(commanded.players[2].ap).toBe(1);
  const stolen = s.players[2].inventory[0].id;
  act({ type: "nightReward", player: 0, item: stolen });
  reload();
  expect(s.players[0].inventory.filter((i) => i.id === stolen)).toHaveLength(1);
  expect(s.players[2].inventory.some((i) => i.id === stolen)).toBe(false);
  expect(s.logs.filter((l) => l.type === "loot" && l.actor === 0)).toHaveLength(
    1,
  );
  expect(() =>
    dispatch(s, { type: "nightReward", player: 0, item: stolen }),
  ).toThrow();
  act({ type: "advance" });
  reload();
  expect(s.players.every((p) => p.dailyHistory.length === 1)).toBe(true);
});

it("registers only surviving directions, with barrier before available defensive potions", () => {
  const s = create();
  s.phase = "night";
  s.publicTurn.order = [2, 0, 1, 3];
  const target = s.players[1];
  addItem(s, target, "invisibility");
  s.barriers = [1];
  chooseNight(s, s.players[0], { kind: "scout", target: 1 });
  chooseNight(s, target, { kind: "raid", target: 0 });
  chooseNight(s, s.players[2], { kind: "scout", target: 1 });
  registerNight(s);
  expect(s.nightWork?.battles).toMatchObject([
    { participants: [1, 0], raids: [1] },
  ]);
  expect(target.inventory.some((i) => i.kind === "invisibility")).toBe(true);
});

it("uses defensive stock in seat order and keeps newly brewed stock for tomorrow", () => {
  const s = create();
  s.phase = "night";
  s.publicTurn.order = [2, 0, 1, 3];
  const target = s.players[1];
  target.stats.insight = 9;
  unlockNightRecipes(target);
  addItem(s, target, "water");
  addItem(s, target, "dew");
  addItem(s, target, "invisibility");
  chooseNight(s, target, { kind: "rest", recipes: ["invisibility"] });
  chooseNight(s, s.players[0], { kind: "scout", target: 1 });
  chooseNight(s, s.players[2], { kind: "scout", target: 1 });
  registerNight(s);
  expect(s.nightWork?.valid).toEqual([0]);
  expect(
    target.inventory.filter((i) => i.kind === "invisibility"),
  ).toMatchObject([{ usableDay: 2 }]);
  finishNight(s);
  expect(s.logs.find((l) => l.type === "scout")?.text).toContain(
    "夜間行動：休息",
  );
  expect(s.logs.filter((l) => l.type === "usePotion")).toHaveLength(1);
});

it("records last-night curse and rest without creating tomorrow's modifiers", () => {
  const s = create();
  s.day = 8;
  s.phase = "night";
  chooseNight(s, s.players[0], { kind: "curse", target: 1 });
  registerNight(s);
  finishNight(s);
  expect(s.logs.some((l) => l.type === "curseHit")).toBe(true);
  expect(s.logs.some((l) => l.type === "rest" && l.actor === 1)).toBe(true);
  expect(s.players.every((p) => p.rest === 0 && p.curse === 0)).toBe(true);
});
