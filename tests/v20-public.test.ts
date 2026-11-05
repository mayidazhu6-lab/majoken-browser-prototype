import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import { V20_RULES_VERSION } from "../src/domain/config";
import { reserve, resolveEvent, withdraw } from "../src/domain/events";
import { addItem } from "../src/domain/items";
import { deserialize, serialize } from "../src/domain/persistence";
import { createGame, dispatch } from "../src/domain/reducer";
import type { Setup } from "../src/domain/types";
import { useGameStore } from "../src/stores/game";

const setup: Setup = {
  name: "アリア",
  seed: "public-v2",
  magic: "barrier",
  stats: { attack: 3, defense: 3, insight: 3 },
};
const newGame = () => createGame(setup, V20_RULES_VERSION);

afterEach(() => vi.unstubAllGlobals());

describe("v2.0 public milestone", () => {
  it("starts with four valid allocations and replays two rounds through the event result", () => {
    let state = newGame();
    for (const player of state.players) {
      expect(Object.values(player.stats).reduce((a, b) => a + b)).toBe(9);
      expect(
        Object.values(player.stats).every((value) => value >= 2 && value <= 5),
      ).toBe(true);
      expect(player.inventory).toHaveLength(3);
      expect(player.ap).toBe(2);
      expect(["barrier", "foresight"]).toContain(player.magic);
    }
    state = dispatch(state, { type: "gather", player: 0 });
    expect(state.players[0].ap).toBe(1);
    expect(() => dispatch(state, { type: "gather", player: 0 })).toThrow();
    state = dispatch(state, { type: "endTurn", player: 0 });
    expect(state.publicTurn.round).toBe(2);
    state = dispatch(state, { type: "endTurn", player: 0 });
    expect(state.publicTurn.round).toBe(4);
    expect(state.event.resolved).toBe(true);
    expect(state.logs.filter((log) => log.type === "eventResult")).toHaveLength(
      1,
    );
    expect(state.combatHistory).toEqual([]);
    expect(state.players.every((player) => !player.night)).toBe(true);
    expect(deserialize(serialize(state))).toEqual(state);
    const confirmed = dispatch(state, { type: "eventAck", player: 0 });
    expect(() => dispatch(confirmed, { type: "advance" })).toThrow(
      "協力イベント",
    );
  });

  it("adopts required materials before overflow and rewards only accepted contributors", () => {
    const state = newGame();
    state.event.id = 5;
    const [a, b, c] = state.players;
    reserve(
      state,
      a,
      ["herb", "sand", "sand", "sand", "sand", "sand"].map(
        (kind) => addItem(state, a, kind).id,
      ),
      {},
    );
    const water = addItem(state, b, "water");
    reserve(state, b, [water.id], {});
    const excess = addItem(state, c, "dew");
    reserve(state, c, [excess.id], {});
    resolveEvent(state);
    expect(state.event.success).toBe(true);
    expect([a.fp, b.fp, c.fp]).toEqual([1, 1, 0]);
    expect(b.inventory.some((item) => item.id === water.id)).toBe(false);
    expect(
      c.inventory.find((item) => item.id === excess.id)?.lock,
    ).toBeUndefined();
    expect(a.inventory).toHaveLength(4);
  });

  it("keeps the still-qualified E12 route when the first route is withdrawn", () => {
    const state = newGame();
    state.event.id = 12;
    const [a, b] = state.players;
    const items = Array.from({ length: 8 }, () => addItem(state, a, "sand").id);
    reserve(state, a, items, {});
    b.stats = { attack: 3, defense: 3, insight: 3 };
    reserve(state, b, [], { attack: 2, defense: 2, insight: 1 });
    withdraw(state, a);
    reserve(state, a, items, {});
    resolveEvent(state);
    expect(state.event.success).toBe(true);
    expect(state.event.route).toBe("stats");
    expect(a.inventory).toHaveLength(11);
    expect([a.fp, b.fp]).toEqual([0, 2]);
  });

  it("revalidates an unlocked trade against a later event reservation", () => {
    let state = newGame();
    state.event.id = 1;
    state.players[1].ai = false;
    state.players[0].inventory = [];
    const offered = addItem(state, state.players[0], "herb");
    state = dispatch(state, {
      type: "trade",
      player: 0,
      target: 1,
      offer: [offered.id],
      request: {},
    });
    const trade = state.trades[0];
    expect(state.players[0].inventory[0].lock).toBeUndefined();
    state = dispatch(state, {
      type: "reserve",
      player: 0,
      items: [offered.id],
      stats: {},
    });
    state = dispatch(state, {
      type: "tradeReply",
      player: 1,
      id: trade.id,
      accept: true,
    });
    expect(state.trades).toHaveLength(0);
    expect(state.players[0].inventory[0].lock).toBe("event");
    expect(state.logs.at(-1)?.type).toBe("tradeRejected");
  });

  it("releases reservations and ends immediately on a third failure", () => {
    const state = newGame();
    state.failed = 2;
    state.event.id = 2;
    const player = state.players[0];
    const item = addItem(state, player, "herb");
    reserve(state, player, [item.id], {});
    state.publicTurn.round = 4;
    const ended = dispatch(state, { type: "advance" });
    expect(ended.result?.reason).toBe("collapse");
    expect(ended.failed).toBe(3);
    expect(
      ended.players[0].inventory.find((owned) => owned.id === item.id)?.lock,
    ).toBeUndefined();
    expect(ended.logs.some((log) => log.type === "dailyHOSkipped")).toBe(true);
    expect(
      ended.players.every((p) => !p.night && p.dailyHistory.length === 0),
    ).toBe(true);
  });

  it("leaves the legacy slot untouched and retries the same candidate after a save failure", () => {
    const values = new Map([["majoken-save-v2", "legacy"]]);
    let reject = false;
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (reject) throw Error("storage unavailable");
        values.set(key, value);
      },
    });
    setActivePinia(createPinia());
    const store = useGameStore();
    store.load();
    expect(store.error).toContain("ルール版");
    store.start(setup);
    const initial = store.state;
    const oldSave = values.get("majoken-save-rules-2.0");
    reject = true;
    store.act({ type: "gather", player: 0 });
    const candidate = store.pending;
    expect(candidate?.players[0].ap).toBe(1);
    expect(store.state).toBe(initial);
    store.act({ type: "endTurn", player: 0 });
    expect(store.pending).toBe(candidate);
    expect(values.get("majoken-save-rules-2.0")).toBe(oldSave);
    reject = false;
    store.save();
    expect(store.state).toBe(candidate);
    expect(store.pending).toBeUndefined();
    expect(values.get("majoken-save-v2")).toBe("legacy");
    store.load();
    expect(store.state).toEqual(candidate);
  });
});
