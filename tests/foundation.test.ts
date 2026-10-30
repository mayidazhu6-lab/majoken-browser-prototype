import { describe, it, expect } from "vitest";
import { hashSeed } from "../src/domain/rng";
import { level, RESEARCH } from "../src/domain/config";
describe("Phase 1 基盤", () => {
  it("seedハッシュ再現", () => expect(hashSeed("魔女")).toBe(hashSeed("魔女")));
  it("能力Lv境界", () => expect([5, 6, 8, 9].map(level)).toEqual([1, 2, 2, 3]));
  it("研究レシピは既存素材2種", () =>
    expect(
      Object.values(RESEARCH).every(
        (r) => r.length === 2 && !r.includes("dew"),
      ),
    ).toBe(true));
});
