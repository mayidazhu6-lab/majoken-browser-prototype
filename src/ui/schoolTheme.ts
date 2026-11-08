/** Presentation only: result confirmation can outlive the phase that produced it. */
export function schoolTheme(
  phase?: string,
  event?: { resolved: boolean; acknowledged?: boolean },
): "day" | "night" {
  if (event?.resolved && !event.acknowledged) return "day";
  return [
    "magic",
    "vote",
    "night",
    "duels",
    "rewards",
    "results",
    "ho",
    "dawn",
  ].includes(phase ?? "")
    ? "night"
    : "day";
}
