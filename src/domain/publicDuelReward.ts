import { V20_RULES_VERSION, V21_RULES_VERSION } from "./config";

/** Versioned public-duel FP only; old saves retain their original reward. */
export function publicDuelReward(s: { day: number; rulesVersion: string }) {
  return (s.rulesVersion === V20_RULES_VERSION ||
    s.rulesVersion === V21_RULES_VERSION) &&
    s.day >= 5 &&
    s.day <= 8
    ? 2
    : 1;
}
