import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { schoolTheme } from "../src/ui/schoolTheme";
import { iconDefinition, shapes } from "../src/ui/iconCatalog";
import { MATERIALS, STATS } from "../src/domain/config";
import { NIGHT_RECIPES } from "../src/domain/night";
import { RECIPES } from "../src/domain/items";

it.each(["public", "ho", "dawn", "ended", undefined])(
  "%s uses the daylight presentation",
  (phase) => expect(schoolTheme(phase)).toBe("day"),
);
it.each(["magic", "vote", "night", "duels", "rewards", "results"])(
  "%s uses moonlight",
  (phase) => expect(schoolTheme(phase)).toBe("night"),
);
it("all six materials have distinct silhouettes", () => {
  expect(
    new Set(MATERIALS.map((kind) => shapes[iconDefinition(kind).shape])).size,
  ).toBe(6);
  for (const kind of MATERIALS) expect(iconDefinition(kind).shape).toBe(kind);
});
it("current potions all have different emblems and historical potions remain covered", () => {
  const marks = NIGHT_RECIPES.map((r) => iconDefinition(r.id).mark);
  expect(marks.every(Boolean)).toBe(true);
  expect(new Set(marks).size).toBe(NIGHT_RECIPES.length);
  for (const r of RECIPES) expect(iconDefinition(r.id).mark).toBeDefined();
});
it("modern attributes use elemental symbols and legacy attributes retain their meaning", () => {
  expect(STATS.map((s) => iconDefinition(s).shape)).toEqual([
    "fire",
    "drop",
    "wind",
  ]);
  expect(STATS.map((s) => iconDefinition(s, true).shape)).toEqual([
    "sword",
    "shield",
    "eye",
  ]);
});
const css = readFileSync(
  new URL("../src/schoolTheme.css", import.meta.url),
  "utf8",
);
const definitions = (text: string) =>
  Object.fromEntries(
    [...text.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [
      m[1],
      m[2],
    ]),
  );
const day = definitions(css.match(/:root\s*\{([^}]+)\}/)![1]);
const night = {
  ...day,
  ...definitions(css.match(/:root\[data-theme="night"\]\s*\{([^}]+)\}/)![1]),
};
function luminance(hex: string) {
  const [r, g, b] = hex
    .slice(1)
    .match(/../g)!
    .map((x) => parseInt(x, 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
for (const [name, palette] of [
  ["day", day],
  ["night", night],
] as const) {
  it(`${name}: text pairs meet 4.5:1 and functional icons meet 3:1`, () => {
    for (const [fg, bg] of [
      ["--ink", "--panel"],
      ["--ink", "--surface"],
      ["--ink", "--page"],
      ["--muted", "--panel"],
      ["--on-primary", "--primary"],
      ["--mint", "--panel"],
      ["--pink", "--panel"],
    ])
      expect(
        contrast(palette[fg], palette[bg]),
        `${fg} on ${bg}`,
      ).toBeGreaterThanOrEqual(4.5);
    for (const key of [
      "--icon-obsidian",
      "--icon-crystal",
      "--icon-herb",
      "--icon-sand",
      "--icon-water",
      "--icon-dew",
      "--icon-fire",
      "--icon-wind",
      "--icon-potion",
      "--gold",
    ])
      expect(
        contrast(palette[key], palette["--panel"]),
        key,
      ).toBeGreaterThanOrEqual(3);
  });
}
