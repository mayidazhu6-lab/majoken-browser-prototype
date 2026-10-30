import { describe, it, expect } from "vitest";
import { createGame, dispatch } from "../src/domain/reducer";
import { serialize, deserialize } from "../src/domain/persistence";
const setup = {
  name: "テスト魔女",
  seed: "phase1",
  magic: "barrier" as const,
  stats: { attack: 4, defense: 3, insight: 3 },
};
describe("Phase 1 状態・保存", () => {
  it("A01 4席・合計10・初期素材3・AP2", () => {
    const s = createGame(setup);
    expect(s.players).toHaveLength(4);
    for (const p of s.players) {
      expect(Object.values(p.stats).reduce((a, b) => a + b)).toBe(10);
      expect(p.inventory).toHaveLength(3);
      expect(p.ap).toBe(2);
    }
  });
  it("A11 保存再開とseed再現", () => {
    let s = createGame(setup);
    s = dispatch(s, { type: "gather", player: 0 });
    expect(deserialize(serialize(s))).toEqual(s);
    expect(createGame(setup)).toEqual(createGame(setup));
  });
  it("A04 不正要求は原状態を変更しない", () => {
    const s = createGame(setup);
    const old = JSON.stringify(s);
    expect(() =>
      dispatch(s, { type: "shop", player: 0, items: [], receive: "dew" }),
    ).toThrow();
    expect(JSON.stringify(s)).toBe(old);
  });
});
