import { describe, it, expect } from "vitest";
import { simulate } from "../src/domain/simulation";
import { replay, serialize, deserialize } from "../src/domain/persistence";
import { assertInvariants } from "../src/domain/reducer";
describe("Phase 4/5 全ゲーム試遊", () => {
  for (const seed of ["witches-2026", "moon-42", "lab-77"])
    it(`A01/A10/A11 seed=${seed} 停止せず終了し操作再現`, () => {
      const s = simulate(seed);
      expect(s.phase).toBe("ended");
      assertInvariants(s);
      expect(s.combatHistory.every((c) => c.done && c.rounds.length <= 5)).toBe(
        true,
      );
      expect(s.players.every((p) => p.ai || p.id === 0)).toBe(true);
      expect(replay(s.setup, s.actions)).toEqual(s);
      expect(deserialize(serialize(s))).toEqual(s);
    });
  it("セーブ状態の改変を検出", () => {
    const s = simulate("moon-42");
    const data = JSON.parse(serialize(s));
    data.state.players[0].fp += 100;
    expect(() => deserialize(JSON.stringify(data))).toThrow("一致しません");
  });
});
