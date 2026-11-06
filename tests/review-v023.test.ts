import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createGame, dispatch } from "../src/domain/reducer";
import { CONFIG, LEGACY_RULES_VERSION } from "../src/domain/config";
import { EVENTS, drawEvent } from "../src/domain/events";
import { addItem, RECIPES, isMaterial } from "../src/domain/items";
import { deserialize, serialize } from "../src/domain/persistence";
import { plannedMaterials, potionDescription } from "../src/ui/alchemy";
import { simulationAction } from "../src/domain/simulation";
const setup = {
  name: "レビュー検証",
  seed: "alchemy-review",
  magic: "barrier" as const,
  stats: { attack: 4, defense: 3, insight: 3 },
};

describe("alchemy preview and existing validation", () => {
  it("describes all recipes without requiring ownership or unlocking", () => {
    expect(RECIPES).toHaveLength(14);
    for (const r of RECIPES) {
      expect(potionDescription(r.id).length).toBeGreaterThan(10);
      if (
        ["gather", "research", "guard", "attack", "defense", "charge"].includes(
          r.effect,
        )
      )
        expect(potionDescription(r.id)).toContain(`+${r.power}`);
    }
    expect(potionDescription("omniscience")).toContain("すべて");
    expect(potionDescription("omniscience")).not.toContain("999");
    expect(potionDescription("sight")).toContain("最大2個");
    expect(potionDescription("cleanse")).toContain("自動消費");
    expect(potionDescription("purify")).toContain("呪詛も無効化");
  });
  it("counts repeated recipes and shared materials, restores counts on removal, never mutates inventory", () => {
    const s = createGame(setup),
      p = s.players[0];
    p.inventory = [];
    for (const kind of [
      "obsidian",
      "obsidian",
      "obsidian",
      "crystal",
      "crystal",
    ])
      addItem(s, p, kind);
    const before = JSON.stringify(p);
    const plan = ["study", "wisdom", "study"];
    expect(
      plannedMaterials(p, plan).find((m) => m.kind === "obsidian"),
    ).toMatchObject({ owned: 3, planned: 3, available: 0 });
    expect(
      plannedMaterials(p, plan).find((m) => m.kind === "crystal"),
    ).toMatchObject({ owned: 2, planned: 1, available: 1 });
    plan.splice(1, 1);
    expect(
      plannedMaterials(p, plan).find((m) => m.kind === "crystal"),
    ).toMatchObject({ planned: 0, available: 2 });
    expect(
      plannedMaterials(p, plan).find((m) => m.kind === "obsidian"),
    ).toMatchObject({ planned: 2, available: 1 });
    expect(JSON.stringify(p)).toBe(before);
    p.inventory.at(-1)!.lock = "event";
    expect(
      plannedMaterials(p, plan).find((m) => m.kind === "crystal"),
    ).toMatchObject({ owned: 2, reserved: 1, remaining: 2, available: 1 });
  });
  it("matches actual material consumption; existing overcraft and locked-recipe rejection remain", () => {
    let s = createGame(setup);
    s.phase = "night";
    s.players[0].inventory = [];
    for (const kind of ["obsidian", "obsidian", "crystal"])
      addItem(s, s.players[0], kind);
    const plan = ["study", "study", "vigor"];
    const before = JSON.stringify(s);
    const preview = plannedMaterials(s.players[0], plan);
    expect(() =>
      dispatch(s, {
        type: "night",
        player: 0,
        choice: { kind: "brew", recipes: [...plan, "study"] },
      }),
    ).toThrow("素材不足");
    expect(() =>
      dispatch(s, {
        type: "night",
        player: 0,
        choice: { kind: "brew", recipes: ["harvest"] },
      }),
    ).toThrow("未解放");
    expect(JSON.stringify(s)).toBe(before);
    s = dispatch(s, {
      type: "night",
      player: 0,
      choice: { kind: "brew", recipes: plan },
    });
    s = dispatch(s, { type: "advance" });
    for (const m of preview)
      expect(
        s.players[0].inventory.filter((i) => i.kind === m.kind).length,
      ).toBe(m.available);
    expect(
      s.players[0].inventory.filter((i) => !isMaterial(i.kind)),
    ).toHaveLength(3);
  });
});
describe("day-one event eligibility and replay compatibility", () => {
  it("excludes potion delivery on day one and keeps every other event eligible", () => {
    const seen = new Set<number>();
    for (let n = 0; n < 1000; n++) {
      const s = createGame({ ...setup, seed: `event-review-${n}` });
      seen.add(s.event.id);
      expect(EVENTS.find((e) => e.id === s.event.id)?.potions).toBeUndefined();
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(
      EVENTS.filter((e) => !e.potions).map((e) => e.id),
    );
  });
  it("day two and later keep the old candidate pool, weights and draws (including potions)", () => {
    const seen = new Set<number>();
    for (let day = 2; day <= 8; day++)
      for (let n = 0; n < 100; n++) {
        const old = createGame(
          { ...setup, seed: `after-first-${n}` },
          LEGACY_RULES_VERSION,
        );
        old.usedEvents = [];
        const current = structuredClone(old);
        current.rulesVersion = CONFIG.rulesVersion;
        const selected = drawEvent(current, day);
        expect(selected).toBe(drawEvent(old, day));
        expect(current.rng).toBe(old.rng);
        expect(current.draws).toBe(old.draws);
        seen.add(selected);
      }
    for (const e of EVENTS.filter((e) => e.potions))
      expect(seen.has(e.id)).toBe(true);
  });
  it("keeps used and explicitly excluded events excluded", () => {
    const s = createGame(setup);
    s.usedEvents = EVENTS.slice(0, -2).map((e) => e.id);
    expect(drawEvent(s, 2, [EVENTS.at(-1)!.id])).toBe(EVENTS.at(-2)!.id);
  });
  it("loads a save generated by the actual pre-review implementation and continues under its original rules", () => {
    const raw = readFileSync(
      new URL("./fixtures/before-v023-review.json", import.meta.url),
      "utf8",
    );
    let s = deserialize(raw);
    expect(s.rulesVersion).toBe(LEGACY_RULES_VERSION);
    expect(EVENTS.find((e) => e.id === s.event.id)?.potions).toBeGreaterThan(0);
    s = dispatch(s, simulationAction(s));
    expect(deserialize(serialize(s))).toEqual(s);
  });
});
