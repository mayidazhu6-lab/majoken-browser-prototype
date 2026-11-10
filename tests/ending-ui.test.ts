import { expect, it } from "vitest";
import { createGame } from "../src/domain/reducer";
import { log, fp } from "../src/domain/core";
import { beginDay8Fp, finishDay8Fp } from "../src/domain/day8Fp";
import {
  endingRows,
  endingView,
  endingSummary,
  endingGoal,
  fpReason,
} from "../src/ui/ending";
import { serialize } from "../src/domain/persistence";
import { day8Setup } from "./fixtures/v21Day8";
function ended() {
  const s = createGame(day8Setup, "browser-2.1");
  s.day = 8;
  s.phase = "ended";
  s.result = {
    reason: "completed",
    chiefs: [2, 0],
    graduates: [0, 1, 2],
    ranking: [
      { player: 0, rank: 1, fp: 7, daily: 3, graduated: true },
      { player: 1, rank: 3, fp: 6, daily: 2, graduated: true },
      { player: 2, rank: 1, fp: 7, daily: 3, graduated: true },
      { player: 3, rank: null, fp: 100, daily: 8, graduated: false },
    ],
  };
  return s;
}
it("sorts confirmed chiefs, graduates, failures by saved rank and seat without comparing FP", () => {
  const s = ended();
  const raw = serialize(s);
  const rows = endingRows(s);
  expect(rows.map((r) => r.player)).toEqual([0, 2, 1, 3]);
  expect(rows.map((r) => r.outcome)).toEqual(["首席", "首席", "卒業", "落第"]);
  expect(rows.map((r) => r.rankText)).toEqual([
    "同率1位",
    "同率1位",
    "3位",
    "順位なし",
  ]);
  expect(rows[3].fp).toBe(100);
  expect(serialize(s)).toBe(raw);
});
it("all failures are shown in seat order with no invented chief or rank", () => {
  const s = ended();
  s.result!.chiefs = [];
  s.result!.graduates = [];
  for (const r of s.result!.ranking) {
    r.rank = null;
    r.graduated = false;
  }
  expect(endingRows(s).map((r) => [r.player, r.outcome, r.rankText])).toEqual(
    [0, 1, 2, 3].map((id) => [id, "落第", "順位なし"]),
  );
});
it("collapse ignores old achievement flags, gives no ranks and uses seats", () => {
  const s = ended();
  s.result!.reason = "collapse";
  expect(endingView(s, "summary")).toBe("results");
  expect(
    endingRows(s).map((r) => [r.player, r.outcome, r.status, r.rankText]),
  ).toEqual([0, 1, 2, 3].map((id) => [id, "研究所崩壊", "未判定", "順位なし"]));
});
it("normal completed game defaults to summary and only explicit selection chooses results", () => {
  const s = ended();
  expect(endingView(s, "summary")).toBe("summary");
  expect(endingView(s, "results")).toBe("results");
});
it("summary contains only actual own daily/night records, not result or third-party secret logs", () => {
  const s = ended();
  s.players[0].dailyHistory = [{ day: 8, id: 1, achieved: true }];
  log(s, "fp", "own HO", { actor: 0, amount: 1, kind: "ho", audience: [0] });
  s.phase = "results";
  log(s, "scout", "own scout", { actor: 0, target: 1, audience: [0] });
  log(s, "combat", "third party secret", {
    actor: 1,
    target: 2,
    audience: [1, 2],
    data: { rounds: ["hidden"] },
  });
  log(s, "nightInventory", "inventory", {
    actor: 0,
    audience: [0],
    data: { items: { herb: 2 } },
  });
  s.phase = "ended";
  log(s, "end", "long outcome must not appear", { data: { ...s.result } });
  const raw = serialize(s),
    v = endingSummary(s);
  expect(v.night.map((l) => l.text)).toEqual(["own scout"]);
  expect(v.reward).toBe(1);
  expect(v.inventory).toEqual({ herb: 2 });
  expect(v.players.every((p) => p.breakdown === undefined)).toBe(true);
  expect(JSON.stringify(v)).not.toMatch(
    /long outcome|third party secret|rounds|longGoal|chiefs|ranking/,
  );
  v.inventory!.herb = 999;
  expect(serialize(s)).toBe(raw);
});
it("missing data stays missing and recorded zero stays empty", () => {
  const s = ended();
  expect(endingSummary(s).inventory).toBeUndefined();
  expect(endingSummary(s).reward).toBeUndefined();
  delete s.result;
  s.phase = "ho";
  beginDay8Fp(s);
  finishDay8Fp(s);
  s.result = ended().result;
  s.phase = "ended";
  expect(
    endingSummary(s).players.every(
      (p) => p.breakdown?.entries.length === 0 && p.breakdown.change === 0,
    ),
  ).toBe(true);
});
it("reason labels use actual deltas elsewhere and related confirmed names/events, never raw unknown text", () => {
  const s = ended();
  const entry = {
    order: 1,
    day: 8 as const,
    player: 0,
    amount: -2,
    fpAfter: 1,
    reason: "scout",
    relatedPlayers: [2],
  };
  expect(fpReason(s, entry)).toBe(`偵察による減点（${s.players[2].name}）`);
  expect(fpReason(s, { ...entry, reason: "secret dump" })).not.toContain(
    "secret dump",
  );
  expect(fpReason(s, { ...entry, reason: "event", eventId: 3 })).toContain(
    "魔導書の整理整頓",
  );
});
it("goal descriptions use the saved rules version without applying new HO conditions to old versions", () => {
  const s = ended();
  s.players[0].longGoal = { id: 5, targets: [1], achieved: false };
  expect(endingGoal(s, s.players[0].longGoal, true).condition).toContain(
    s.players[1].name,
  );
  s.rulesVersion = "browser-2.0.4";
  expect(endingGoal(s, s.players[0].longGoal, true).condition).not.toContain(
    "自動勝利",
  );
});
