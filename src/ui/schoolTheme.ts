/** Presentation only: no persisted theme or game-state mutation. */
export function schoolTheme(phase?: string): "day" | "night" {
  return ["magic", "vote", "night", "duels", "rewards", "results"].includes(
    phase ?? "",
  )
    ? "night"
    : "day";
}
