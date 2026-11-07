/** Shared vector silhouettes. IDs are presentation aliases, never item/rule IDs. */
export const shapes = {
  obsidian:
    "M6 24 4 15 12 5 23 7 28 20 20 28 6 24ZM12 5l3 12-9 7m9-7 8-10m-8 10 5 11m-5-11 13 3",
  crystal:
    "M16 3 25 10 23 25 16 29 8 24 6 11 16 3Zm0 0v26M6 11l10 5 9-6M8 24l8-8 7 9",
  herb: "M24 4C12 2 4 9 5 19c1 8 12 11 21 5-10 1-17-8-2-20ZM7 26c2-7 5-11 10-15",
  sand: "m11 5 10 0-2 6c10 9 11 17-3 17S3 20 13 11l-2-6Zm0 6h10M16 14l1.5 3 3.5.5-2.5 2.5.5 3.5-3-1.5-3 1.5.5-3.5-2.5-2.5 3.5-.5L16 14Z",
  water:
    "M12 4h8v5l5 6v12H7V15l5-6V4Zm-1 0h10M8 17h16M16 12c-5 6-5 9 0 9s5-3 0-9Z",
  dew: "M16 3C12 9 6 14 6 20a10 10 0 0 0 20 0c0-6-6-11-10-17ZM11 20a5 5 0 0 0 5 5M24 3v6m-3-3h6",
  fire: "M17 3c1 8-7 8-4 14-4 0-5-3-5-5-8 10 0 19 8 17 12-1 13-12 6-18 1 6-2 6-3 7 2-7 2-10-2-15Z",
  drop: "M16 3C12 10 6 15 6 21a10 10 0 0 0 20 0c0-6-6-11-10-18ZM11 20a5 5 0 0 0 5 5",
  wind: "M3 12h18c8 0 8-10 2-10-4 0-5 4-3 5M3 17h22c7 0 6 10 0 10-4 0-5-4-3-5M5 22h10c5 0 4 7 0 7",
  sword: "m6 27 9-9m-5-3 7 7M13 16 25 3l4 1-1 4-12 12M4 24l4 4",
  shield:
    "M16 3 27 7v10c-1 6-6 10-11 12C11 27 6 23 5 17V7l11-4Zm0 5v15m-6-10h12",
  eye: "M3 16c7-11 19-11 26 0-7 11-19 11-26 0Zm13-6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0 3v6",
  book: "M16 7C12 3 5 4 3 5v22c5-2 9-1 13 2 4-3 8-4 13-2V5c-5-2-9-1-13 2Zm0 0v22M7 10l5 1m-5 5 5 1m8-6 5-1m-5 7 5-1",
  star: "m16 3 4 8 9 2-7 6 2 10-8-5-8 5 2-10-7-6 9-2 4-8Z",
  moon: "M24 4C7 0 0 19 13 27c5 3 11 2 15-2C14 28 7 12 24 4Z",
  sun: "M16 9a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM16 2v3m0 22v3M2 16h3m22 0h3M6 6l3 3m14 14 3 3M26 6l-3 3M9 23l-3 3",
  bag: "M9 9a7 7 0 0 1 14 0M6 10h20l2 19H4l2-19Zm4 6v5m12-5v5",
  coin: "M16 3a13 13 0 1 0 0 26 13 13 0 0 0 0-26Zm0 5 3 5 5 1-4 4 1 6-5-3-5 3 1-6-4-4 5-1 3-5Z",
  cross: "M12 4h8v8h8v8h-8v8h-8v-8H4v-8h8V4Z",
  diamond: "m16 3 12 13-12 13L4 16 16 3Zm-8 13h16M16 9v14",
  spiral: "M16 16c-5-5 3-10 7-5 7 9-7 19-14 10C-1 8 20-3 28 10",
  potion: "M12 3h8v8c10 6 10 18-4 18S2 17 12 11V3Zm-1 0h10M8 18h16",
} as const;
export type IconShape = keyof typeof shapes;
const potionMarks: Record<string, IconShape> = {
  abundance: "herb",
  scholarship: "book",
  bargaining: "coin",
  flame: "fire",
  ice: "drop",
  tornado: "wind",
  purification: "cross",
  invisibility: "eye",
  might: "sword",
  vigor: "sun",
  study: "book",
  cleanse: "drop",
  watch: "shield",
  sight: "eye",
  harvest: "herb",
  wisdom: "star",
  purify: "cross",
  aegis: "diamond",
  omniscience: "spiral",
  strike: "sword",
  iron: "shield",
  focus: "eye",
  talent: "moon",
};
export function iconDefinition(
  kind: string,
  legacy = false,
): { shape: IconShape; tone: string; mark?: IconShape } {
  if (potionMarks[kind])
    return { shape: "potion", tone: "potion", mark: potionMarks[kind] };
  if (["attack", "defense", "insight"].includes(kind))
    return {
      shape: (
        {
          attack: legacy ? "sword" : "fire",
          defense: legacy ? "shield" : "drop",
          insight: legacy ? "eye" : "wind",
        } as const
      )[kind as "attack" | "defense" | "insight"],
      tone: ({ attack: "fire", defense: "water", insight: "wind" } as const)[
        kind as "attack" | "defense" | "insight"
      ],
    };
  if (kind in shapes)
    return {
      shape: kind as IconShape,
      tone: [
        "obsidian",
        "crystal",
        "herb",
        "sand",
        "water",
        "dew",
        "fire",
        "wind",
      ].includes(kind)
        ? kind
        : "accent",
    };
  return { shape: "potion", tone: "potion" };
}
