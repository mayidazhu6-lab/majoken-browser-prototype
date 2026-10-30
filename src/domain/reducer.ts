import type {
  Action,
  Combat,
  GameState,
  Magic,
  Night,
  Player,
  Setup,
  Stat,
} from "./types";
import {
  CONFIG,
  LABELS,
  MAGICS,
  MATERIALS,
  RESEARCH,
  STATS,
  level,
} from "./config";
import { hashSeed, pick, sample } from "./rng";
import {
  addItem,
  available,
  canRecipe,
  consume,
  isMaterial,
  materialIds,
  recipe,
  RECIPES,
} from "./items";
import {
  EVENTS,
  donationItems,
  eventProgress,
  reserve,
  resolveEvent,
  startEvent,
  withdraw,
  drawEvent,
} from "./events";
import { dailyAchieved, dealGoals, longAchieved, goalDescription } from "./ho";
import {
  chooseStance,
  chooseCombatPotion,
  loadout,
  resolveRound,
  startCombat,
} from "./combat";
import { fp, log } from "./core";
import { AI_POLICY, weightedAction } from "./ai";
export function createGame(setup: Setup): GameState {
  if (
    !setup.name.trim() ||
    !setup.seed ||
    !MAGICS[setup.magic] ||
    STATS.some(
      (k) =>
        !Number.isInteger(setup.stats[k]) ||
        setup.stats[k] < 2 ||
        setup.stats[k] > 6,
    ) ||
    STATS.reduce((n, k) => n + setup.stats[k], 0) !== 10
  )
    throw Error("名前・seed・能力合計10（各2〜6）を確認してください");
  const s: GameState = {
    version: 2,
    rulesVersion: CONFIG.rulesVersion,
    setup: structuredClone(setup),
    seed: setup.seed,
    rng: hashSeed(setup.seed),
    draws: 0,
    day: 1,
    phase: "public",
    players: [],
    failed: 0,
    usedEvents: [],
    event: {
      id: 1,
      specified: "obsidian",
      reservations: [],
      mock: [],
      resolved: false,
    },
    foresight: [],
    votes: {},
    barriers: [],
    logs: [],
    actions: [],
    revision: 0,
    nextItem: 1,
    nextCombat: 1,
    nextTrade: 1,
    combatHistory: [],
    duelQueue: [],
    trades: [],
    publicTurn: {
      order: [0, 1, 2, 3],
      index: 0,
      round: 1,
      acted: false,
      aiTradeAttempted: false,
      aiMockAttempted: false,
      tradeAttempts: {},
    },
  };
  const names = [setup.name, "リラ", "ネム", "シオン"];
  for (let i = 0; i < 4; i++) {
    const p: Player = {
      id: i,
      name: names[i],
      ai: i !== 0,
      stats:
        i === 0 ? { ...setup.stats } : { attack: 2, defense: 2, insight: 2 },
      ap: 2,
      fp: 0,
      peakFp: 0,
      inventory: [],
      magic:
        i === 0
          ? setup.magic
          : pick(s, Object.keys(MAGICS) as Magic[], "AI固有魔法"),
      availableDay: 1,
      activeMagic: false,
      longGoal: { id: 1, targets: [], achieved: false },
      dailyGoal: { id: 1, targets: [], achieved: false },
      dailyHistory: [],
      recipes: [],
      unlocks: [],
      pendingRecipe: false,
      rest: 0,
      curse: 0,
      immune: false,
      lastRaid: -10,
      commands: [],
      changedMagic: false,
    };
    if (i) for (let n = 0; n < 4; n++) p.stats[pick(s, STATS, "AI初期配分")]++;
    for (let n = 0; n < 3; n++) addItem(s, p, pick(s, MATERIALS, "初期素材"));
    s.players.push(p);
  }
  dealGoals(s, true);
  dealGoals(s);
  startEvent(s);
  log(s, "audit", `ルール ${CONFIG.rulesVersion} / HO除外なし`, {
    audience: "dev",
  });
  return s;
}
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}
function publicAction(s: GameState, p: Player, cost = 1) {
  assert(
    s.phase === "public" && !s.combat && !s.challenge,
    "公開行動フェーズではありません",
  );
  assert(
    s.publicTurn.round <= 3 && s.publicTurn.order[s.publicTurn.index] === p.id,
    "自分の手番ではありません",
  );
  assert(!s.trades.length, "取引への返答を完了してください");
  assert(
    cost === 0 || (s.publicTurn.round <= 2 && !s.publicTurn.acted),
    "この手番の通常行動は終了しています",
  );
  assert(p.ap >= cost, "AP不足です");
  assert(
    cost === 0 || p.commands.length === 0,
    "先に命令のAPを実行してください",
  );
  assert(!p.pendingRecipe, "特殊レシピを選んでください");
}
function ap(s: GameState, p: Player, cost = 1) {
  const curse = p.curse;
  p.ap -= cost;
  if (cost) {
    p.curse = 0;
    if (s.phase === "public") s.publicTurn.acted = true;
  }
  return curse;
}
function used(s: GameState, p: Player, id: number | undefined, effect: string) {
  if (id === undefined) return 0;
  const i = p.inventory.find((i) => i.id === id && !i.lock);
  const r = i && recipe(i.kind);
  assert(r && r.effect === effect, "薬の選択が不正です");
  consume(p, [id]);
  log(s, "usePotion", `${r.name}を使用`, {
    actor: p.id,
    kind: r.id,
    audience: [p.id],
  });
  return r.power;
}
function brew(s: GameState, p: Player, id: string) {
  assert(canRecipe(p, id, s.day), "未解放のレシピです");
  const r = recipe(id)!;
  const ids = materialIds(p, r.materials);
  assert(ids, "素材不足または予約中です");
  consume(p, ids);
  addItem(s, p, id);
  log(s, "brew", `${r.name}を作成`, {
    actor: p.id,
    kind: id,
    amount: 1,
    audience: [p.id],
  });
  log(s, "acquirePotion", `${r.name}を獲得`, {
    actor: p.id,
    kind: id,
    amount: 1,
    audience: [p.id],
  });
}
function transfer(
  s: GameState,
  from: Player,
  to: Player,
  ids: number[],
  source: string,
) {
  const items = ids.map((id) => from.inventory.find((i) => i.id === id)!);
  assert(items.every(Boolean), "移動対象がありません");
  from.inventory = from.inventory.filter((i) => !ids.includes(i.id));
  items.forEach((i) => {
    delete i.lock;
    to.inventory.push(i);
    if (!isMaterial(i.kind))
      log(s, "acquirePotion", "薬を受領", {
        actor: to.id,
        target: from.id,
        amount: 1,
        kind: i.kind,
        audience: [to.id],
      });
  });
  if (items.length) {
    log(s, "receive", "アイテム受領", {
      actor: to.id,
      target: from.id,
      amount: items.length,
      kind: source,
      audience: [to.id],
    });
    if (source === "trade") {
      log(s, "give", "アイテム譲渡", {
        actor: from.id,
        target: to.id,
        amount: items.length,
        audience: [from.id],
      });
      const n = items.filter((i) => !isMaterial(i.kind)).length;
      if (n)
        log(s, "givePotion", "薬を譲渡", {
          actor: from.id,
          target: to.id,
          amount: n,
          audience: [from.id],
        });
    }
  }
}
function cancelTrades(s: GameState) {
  for (const p of s.players)
    p.inventory.forEach((i) => {
      if (i.lock?.startsWith("trade:")) delete i.lock;
    });
  s.trades = [];
}
function replyTrade(s: GameState, p: Player, id: number, accept: boolean) {
  const t = s.trades.find((t) => t.id === id);
  assert(t && t.to === p.id, "取引がありません");
  const a = s.players[t.from];
  const pool = available(p);
  const requested: number[] = [];
  let enough = true;
  for (const [kind, count] of Object.entries(t.request)) {
    const ids = pool
      .filter((i) => i.kind === kind)
      .slice(0, count)
      .map((i) => i.id);
    if (ids.length !== count) enough = false;
    requested.push(...ids);
  }
  const valid =
    t.offer.every((id) =>
      a.inventory.some((i) => i.id === id && i.lock === `trade:${t.id}`),
    ) && enough;
  s.trades = s.trades.filter((t) => t.id !== id);
  a.inventory.forEach((i) => {
    if (i.lock === `trade:${t.id}`) delete i.lock;
  });
  if (!accept || !valid) {
    log(s, "tradeRejected", "取引は成立しませんでした", {
      actor: a.id,
      target: p.id,
      audience: [a.id, p.id],
    });
    return;
  }
  const offered = t.offer.map(
    (id) => a.inventory.find((i) => i.id === id)!.kind,
  );
  const receivedKinds = requested.map(
    (id) => p.inventory.find((i) => i.id === id)!.kind,
  );
  const describeItems = (kinds: string[]) =>
    kinds.map((k) => LABELS[k] ?? recipe(k)?.name ?? k).join("・") || "なし";
  transfer(s, a, p, t.offer, "trade");
  transfer(s, p, a, requested!, "trade");
  for (const [x, y, sent, received] of [
    [a, p, t.offer.length, requested!.length],
    [p, a, requested!.length, t.offer.length],
  ] as const)
    log(
      s,
      "trade",
      `${x.name}と${y.name}の取引成立。${a.name}から${p.name}：${describeItems(offered)}。${p.name}から${a.name}：${describeItems(receivedKinds)}`,
      {
        actor: x.id,
        target: y.id,
        amount: sent,
        data: { received, offered, receivedKinds },
        audience: [a.id, p.id],
      },
    );
}
function finishCombat(s: GameState) {
  const c = s.combat!;
  const [a, b] = c.participants;
  const aud = c.kind === "secret" ? ([a, b] as number[]) : ("public" as const);
  if (!s.combatHistory.some((h) => h.id === c.id)) {
    s.combatHistory.push(structuredClone(c));
    for (const id of [a, b])
      log(
        s,
        "combat",
        `${c.kind === "secret" ? "秘匿決闘" : "対戦"}：${c.winner === null ? "引分" : s.players[c.winner!].name + "の勝利"}`,
        {
          actor: id,
          target: id === a ? b : a,
          data: { id: c.id, kind: c.kind, winner: c.winner },
          audience: aud,
        },
      );
    if (c.kind === "mock") {
      s.event.mock = [a, b];
      s.combat = undefined;
      return;
    }
    if (c.winner !== null) {
      const w = s.players[c.winner!],
        loser = s.players[c.winner === a ? b : a];
      log(s, "win", "決闘勝利", {
        actor: w.id,
        target: loser.id,
        data: { kind: c.kind, initiator: c.initiator },
        audience: aud,
      });
      if (c.kind === "secret" && w.id !== c.initiator)
        log(s, "defensiveWin", "防衛勝利", {
          actor: w.id,
          target: loser.id,
          audience: [w.id],
        });
      if (c.kind === "public") fp(s, w, 1, "duel");
    }
  }
  if (c.winner === null) {
    s.combat = undefined;
    return;
  }
  const w = s.players[c.winner!];
  if (w.ai)
    applyReward(
      s,
      w,
      c.kind === "public"
        ? "item"
        : (s.day < 8 && [10].includes(w.longGoal.id)) ||
            (s.day < 8 && w.dailyGoal.id === 22)
          ? "command"
          : "item",
    );
  else s.phase = "rewards";
}
function applyReward(
  s: GameState,
  w: Player,
  kind: "item" | "command",
  stat?: Stat,
) {
  const c = s.combat!;
  assert(c?.done && c.winner === w.id, "報酬選択できません");
  const loser = s.players[c.participants.find((id) => id !== w.id)!];
  if (c.kind === "public") {
    const opts = STATS.filter(
      (k) =>
        loser.stats[k] -
          s.event.reservations
            .filter((r) => r.player === loser.id)
            .reduce((n, r) => n + (r.stats[k] ?? 0), 0) >
        1,
    );
    const selected = stat ?? opts[0];
    if (selected) {
      assert(opts.includes(selected), "移転できない能力です");
      loser.stats[selected]--;
      w.stats[selected]++;
      log(s, "statTransfer", `${LABELS[selected]}を1移転`, {
        actor: w.id,
        target: loser.id,
        kind: selected,
      });
    }
  } else if (kind === "command") {
    assert(s.day < 8, "8日目は命令不可");
    loser.commands.push({ from: w.id });
    log(s, "command", "翌日の1AP命令を確定", {
      actor: w.id,
      target: loser.id,
      audience: [w.id, loser.id],
    });
  } else {
    const opts = available(loser);
    const item = opts.length ? pick(s, opts, "戦利品抽選") : undefined;
    if (item) transfer(s, loser, w, [item.id], "loot");
    log(
      s,
      "loot",
      item
        ? `戦利品：${LABELS[item.kind] ?? recipe(item.kind)?.name}`
        : "戦利品なし",
      { actor: w.id, target: loser.id, amount: item ? 1 : 0, audience: [w.id] },
    );
  }
  s.phase = c.returnPhase;
  s.combat = undefined;
}
function combatRound(
  s: GameState,
  p: Player,
  a: Extract<Action, { type: "round" }>,
) {
  const c = s.combat!;
  assert(c && !c.done, "戦闘はありません");
  const side = c.participants.indexOf(p.id);
  assert(side >= 0, "参加者ではありません");
  const other = 1 - side;
  const q = s.players[c.participants[other]];
  assert(q.ai, "AI応答以外は未対応");
  if (!c.rounds.length && c.brought[other].length === 0) {
    const ids = available(q)
      .filter((i) => recipe(i.kind)?.tier === "combat")
      .slice(0, level(q.stats.insight))
      .map((i) => i.id);
    if (ids.length) loadout(s, q, ids);
  }
  const choice = chooseStance(
    q.stats,
    p.stats,
    c.charge[other],
    c.charge[side],
    c.previous[other],
    [c.hp[other], c.hp[side]],
    c.brought[other].map((i) => i.kind),
  );
  const choices: [typeof a.stance, typeof a.stance] =
    side === 0 ? [a.stance, choice] : [choice, a.stance];
  const potion = chooseCombatPotion(c.brought[other], choice);
  resolveRound(
    s,
    choices,
    side === 0 ? [a.potion, potion] : [potion, a.potion],
  );
  if (c.done) finishCombat(s);
}
function autoCombats(s: GameState) {
  let limit = 20;
  while (
    s.combat &&
    s.combat.participants.every((id) => s.players[id].ai) &&
    limit--
  ) {
    const c = s.combat;
    if (c.done) {
      finishCombat(s);
      continue;
    }
    if (!c.rounds.length)
      for (const id of c.participants) {
        const p = s.players[id];
        const ids = available(p)
          .filter((i) => recipe(i.kind)?.tier === "combat")
          .slice(0, level(p.stats.insight))
          .map((i) => i.id);
        if (ids.length) loadout(s, p, ids);
      }
    const choices = c.participants.map((id, i) =>
      chooseStance(
        s.players[id].stats,
        s.players[c.participants[1 - i]].stats,
        c.charge[i],
        c.charge[1 - i],
        c.previous[i],
        [c.hp[i], c.hp[1 - i]],
        c.brought[i].map((item) => item.kind),
      ),
    ) as ["attack" | "defend" | "charge", "attack" | "defend" | "charge"];
    resolveRound(s, choices, [
      chooseCombatPotion(c.brought[0], choices[0]),
      chooseCombatPotion(c.brought[1], choices[1]),
    ]);
    if (c.done) finishCombat(s);
  }
}
function magic(s: GameState, p: Player, target?: number) {
  assert(
    s.phase === "magic" && p.availableDay <= s.day && !p.activeMagic,
    "魔法を使えません",
  );
  const m = p.magic;
  assert(!["foresight", "alchemy"].includes(m) || s.day < 8, "第8日は使用不可");
  if (m === "barrier") {
    assert(
      target !== undefined && s.players[target],
      "保護対象を選択してください",
    );
    s.barriers.push(target);
  }
  if (m === "alchemy") {
    const pool = RECIPES.filter(
      (r) => r.tier === "special" && !p.recipes.includes(r.id),
    );
    assert(pool.length, "未解放レシピなし");
    p.temporaryRecipe = {
      kind: pick(s, pool, "秘伝レシピ").id,
      day: s.day + 1,
    };
  }
  if (m === "foresight") {
    if (!s.foresight.length) {
      const candidates: number[] = [];
      for (let i = 0; i < 3; i++)
        candidates.push(drawEvent(s, s.day + 1, candidates));
      s.foresight = candidates;
    }
  }
  p.activeMagic = true;
  p.availableDay = s.day + MAGICS[m].cd;
  log(s, "magic", `${MAGICS[m].name}を使用`, {
    actor: p.id,
    kind: m,
    audience: [p.id],
  });
}
function nightChoice(s: GameState, p: Player, n: Night) {
  assert(s.phase === "night" && !p.night, "秘匿行動は確定済みです");
  assert(
    ["raid", "curse", "guard", "rest", "brew", "scout"].includes(n.kind),
    "夜行動が不正",
  );
  if (["raid", "curse", "scout"].includes(n.kind))
    assert(
      n.target !== undefined && s.players[n.target] && n.target !== p.id,
      "対象を選択してください",
    );
  if (n.kind === "raid") assert(p.lastRaid !== s.day - 1, "襲撃は連夜不可");
  if (n.kind === "brew") {
    const plan = n.recipes ?? (n.recipe ? [n.recipe] : []);
    assert(plan.length > 0, "作成予定の薬を追加してください");
    const copy = structuredClone(p);
    for (const id of plan) {
      assert(canRecipe(copy, id, s.day), "未解放のレシピです");
      const ids = materialIds(copy, recipe(id)!.materials);
      assert(ids, "素材不足または予約中です");
      consume(copy, ids);
    }
    n = { kind: "brew", recipes: [...plan] };
  }
  if (n.potion !== undefined) {
    const r = recipe(
      p.inventory.find((i) => i.id === n.potion && !i.lock)?.kind ?? "",
    );
    assert(
      r &&
        ((n.kind === "scout" && r.effect === "scout") ||
          (n.kind === "guard" && r.effect === "guard")),
      "夜行動用の薬が不正",
    );
    assert(
      !(p.activeMagic && p.magic === "shadow" && r.id === "sight"),
      "影渡りと千里眼は併用不可",
    );
  }
  p.night = { ...n };
  if (n.kind === "raid") p.lastRaid = s.day;
  log(s, "nightChoice", `${LABELS[n.kind]}を確定`, {
    actor: p.id,
    target: n.target,
    kind: n.kind,
    audience: [p.id],
  });
}
function prepareNight(s: GameState) {
  for (const p of s.players) {
    if (!p.night) nightChoice(s, p, { kind: "rest" });
    const n = p.night!;
    if (n.kind === "brew") for (const id of n.recipes!) brew(s, p, id);
    if (n.kind === "guard") {
      const buff = used(s, p, n.potion, "guard");
      if (buff)
        log(s, "guardBuff", "警戒薬補正", {
          actor: p.id,
          amount: buff,
          audience: [p.id],
        });
      log(s, "guard", "警戒を実行", { actor: p.id, audience: [p.id] });
    }
    if (n.kind === "raid" && !s.barriers.includes(n.target!)) {
      const pair: [number, number] = [p.id, n.target!];
      if (!s.duelQueue.some((q) => q.includes(pair[0]) && q.includes(pair[1])))
        s.duelQueue.push(pair);
    }
  }
  s.phase = "duels";
}
function nightResults(s: GameState) {
  for (const p of s.players) {
    const n = p.night!;
    const t = n.target === undefined ? undefined : s.players[n.target];
    if (n.kind === "scout") {
      const power = used(s, p, n.potion, "scout");
      if (s.barriers.includes(t!.id)) {
        log(s, "scout", "偵察は遮断されました", {
          actor: p.id,
          target: t!.id,
          amount: 0,
          audience: [p.id],
        });
        continue;
      }
      const canReduce = [
        "raid",
        "guard",
        ...(p.activeMagic && p.magic === "shadow" ? ["curse"] : []),
      ].includes(t!.night!.kind);
      if (canReduce) fp(s, t!, -1, "scout");
      else {
        const count =
          power >= 999
            ? t!.inventory.length
            : Math.max(1, power) +
              (p.activeMagic && p.magic === "shadow" ? 2 : 0);
        const found = sample(s, t!.inventory, count, "偵察アイテム");
        log(
          s,
          "scout",
          `確認：${found.map((i) => LABELS[i.kind] ?? recipe(i.kind)?.name).join("・") || "所持なし"}`,
          {
            actor: p.id,
            target: t!.id,
            amount: found.length,
            data: { items: found.map((i) => i.kind) },
            audience: [p.id],
          },
        );
      }
    }
    if (n.kind === "curse") {
      if (s.barriers.includes(t!.id) || t!.immune) {
        log(s, "curseBlocked", "呪詛は命中しませんでした", {
          actor: p.id,
          audience: [p.id],
        });
      } else {
        t!.curse = Math.max(t!.curse, level(p.stats.attack));
        log(s, "curseHit", "呪詛が命中", {
          actor: p.id,
          target: t!.id,
          audience: [p.id],
        });
      }
    }
    if (n.kind === "rest") {
      const battles = s.combatHistory.filter(
        (c) =>
          c.kind === "secret" &&
          c.participants.includes(p.id) &&
          s.logs.some(
            (l) =>
              l.day === s.day && l.type === "combat" && l.data?.id === c.id,
          ),
      );
      if (battles.every((c) => c.winner === p.id)) {
        p.rest = CONFIG.rest[level(p.stats.defense) - 1];
        log(s, "rest", `休息成功：翌日の採集・研究 +${p.rest}`, {
          actor: p.id,
          amount: p.rest,
          audience: [p.id],
        });
      }
    }
  }
  for (const p of s.players) {
    if (p.curse) {
      const potion = available(p).find((i) => i.kind === "cleanse");
      if (potion) {
        used(s, p, potion.id, "cleanse");
        p.curse = 0;
      }
      log(s, "cursed", p.curse ? "翌日の最初のAP行動に呪詛" : "浄化しました", {
        actor: p.id,
        audience: [p.id],
      });
    }
    p.immune = false;
  }
  log(s, "nightResult", "夜の結果を確定しました");
  s.phase = "ho";
}
function evaluateHO(s: GameState) {
  const daily = s.players.map((p) => dailyAchieved(s, p));
  const longs = s.players.map((p) => longAchieved(s, p));
  s.players.forEach((p, i) => {
    p.dailyGoal.achieved = daily[i];
    p.dailyHistory.push({ day: s.day, id: p.dailyGoal.id, achieved: daily[i] });
    p.longGoal.achieved =
      longs[i] ||
      (![1, 6, 9, 17, 20, 22, 25, 18].includes(p.longGoal.id) &&
        p.longGoal.achieved);
  });
  s.players.forEach((p, i) => {
    log(
      s,
      "dailyHO",
      `日次HO「${goalDescription(p.dailyGoal, false).name}」：${daily[i] ? "達成 / 報酬 FP+1" : "未達成"}。条件：${goalDescription(p.dailyGoal, false).condition}`,
      {
        actor: p.id,
        amount: daily[i] ? 1 : 0,
        audience: [p.id],
      },
    );
    if (daily[i]) fp(s, p, 1, "ho");
  });
  if (s.day === 8) end(s, "completed");
  else s.phase = "dawn";
}
function end(s: GameState, reason: "completed" | "collapse") {
  const graduates =
    reason === "completed"
      ? s.players.filter((p) => p.longGoal.achieved).map((p) => p.id)
      : [];
  const max = Math.max(
    -1,
    ...graduates.map(
      (id) => s.players[id].dailyHistory.filter((h) => h.achieved).length,
    ),
  );
  const contenders = graduates.filter(
    (id) => s.players[id].dailyHistory.filter((h) => h.achieved).length === max,
  );
  const topFP = Math.max(-1, ...contenders.map((id) => s.players[id].fp));
  const chiefs = contenders.filter((id) => s.players[id].fp === topFP);
  s.result = {
    reason,
    graduates,
    chiefs,
    ranking: s.players.map((p) => ({
      player: p.id,
      rank: 1 + s.players.filter((q) => q.fp > p.fp).length,
      fp: p.fp,
      daily: p.dailyHistory.filter((h) => h.achieved).length,
      graduated: graduates.includes(p.id),
    })),
  };
  s.phase = "ended";
  log(
    s,
    "end",
    reason === "collapse"
      ? "協力イベント3失敗：研究所崩壊、全員敗北"
      : "8日間の研究が終了しました",
    { data: { ...s.result } },
  );
}
function nextDay(s: GameState) {
  for (const p of s.players)
    if (p.temporaryRecipe?.day === s.day) p.temporaryRecipe = undefined;
  s.day++;
  s.phase = "public";
  s.barriers = [];
  s.foresight = [];
  s.votes = {};
  for (const p of s.players) {
    p.ap = 2;
    p.night = undefined;
    p.activeMagic = false;
    if (p.nextMagic) {
      p.magic = p.nextMagic;
      p.availableDay = s.day;
      p.nextMagic = undefined;
    }
    p.commands = p.commands.slice(0, 2);
  }
  s.publicTurn = {
    order: Array.from({ length: 4 }, (_, i) => (s.day - 1 + i) % 4),
    index: 0,
    round: 1,
    acted: false,
    aiTradeAttempted: false,
    aiMockAttempted: false,
    tradeAttempts: {},
  };
  dealGoals(s);
  startEvent(s);
}
function forced(
  s: GameState,
  p: Player,
  kind: "gather" | "research",
  stat?: Stat,
) {
  assert(
    kind === "gather" || kind === "research",
    "命令は採集か研究を選択してください",
  );
  assert(p.commands.length, "命令がありません");
  const cmd = p.commands.shift()!;
  const remaining = p.commands;
  p.commands = [];
  apply(
    s,
    kind === "research"
      ? { type: "research", player: p.id, stat: stat! }
      : { type: "gather", player: p.id },
  );
  p.commands = remaining;
  log(
    s,
    "commandExecuted",
    `命令の${kind === "gather" ? "採集" : "研究"}を実行（1AP）`,
    {
      actor: cmd.from,
      target: p.id,
      audience: [cmd.from, p.id],
    },
  );
}
function advance(s: GameState) {
  assert(!s.combat && !s.challenge, "戦闘・挑戦への返答を完了してください");
  assert(
    !s.players.some((p) => p.pendingRecipe),
    "特殊レシピを選択してください",
  );
  switch (s.phase) {
    case "public":
      assert(
        s.publicTurn.round === 4 && !s.trades.length,
        "全員の手番・最終納品確認を完了してください",
      );
      cancelTrades(s);
      resolveEvent(s);
      for (const p of s.players) {
        p.rest = 0;
        p.curse = 0;
      }
      if (s.failed >= 3) end(s, "collapse");
      else {
        s.phase = "magic";
        for (const p of s.players.filter((p) => p.ai))
          if (
            p.availableDay <= s.day &&
            (!["foresight", "alchemy"].includes(p.magic) || s.day < 8)
          ) {
            if (
              p.magic !== "alchemy" ||
              RECIPES.some(
                (r) => r.tier === "special" && !p.recipes.includes(r.id),
              )
            )
              magic(s, p, p.id);
          }
      }
      break;
    case "magic":
      if (s.foresight.length) {
        s.phase = "vote";
        for (const p of s.players.filter(
          (p) => p.ai && p.activeMagic && p.magic === "foresight",
        )) {
          const id = [...s.foresight].sort(
            (a, b) =>
              ["Easy", "Normal", "Hard"].indexOf(EVENTS[a - 1].difficulty) -
              ["Easy", "Normal", "Hard"].indexOf(EVENTS[b - 1].difficulty),
          )[0];
          s.votes[p.id] = id;
        }
      } else enterNight(s);
      break;
    case "vote": {
      const voters = s.players.filter(
        (p) => p.activeMagic && p.magic === "foresight",
      );
      const votes = voters.map(
        (p) => s.votes[p.id] ?? pick(s, s.foresight, "予知無投票補完"),
      );
      const max = Math.max(
        ...s.foresight.map((id) => votes.filter((v) => v === id).length),
      );
      s.nextEvent = pick(
        s,
        s.foresight.filter(
          (id) => votes.filter((v) => v === id).length === max,
        ),
        "予知集計",
      );
      enterNight(s);
      break;
    }
    case "night":
      prepareNight(s);
      break;
    case "duels":
      while (s.duelQueue.length && !s.combat) {
        const [a, b] = s.duelQueue.shift()!;
        startCombat(s, a, b, "secret");
        autoCombats(s);
      }
      if (!s.combat && !s.duelQueue.length) s.phase = "results";
      break;
    case "results":
      nightResults(s);
      break;
    case "ho":
      evaluateHO(s);
      break;
    case "dawn":
      nextDay(s);
      break;
    default:
      throw Error("進行できません");
  }
}
function enterNight(s: GameState) {
  s.phase = "night";
  for (const p of s.players.filter((p) => p.ai)) {
    let kind: Night["kind"] = "rest";
    const daily: Record<number, Night["kind"]> = {
      3: "brew",
      13: "scout",
      14: "raid",
      15: "rest",
      16: "raid",
      17: "curse",
      18: "guard",
      22: "raid",
    };
    const long: Record<number, Night["kind"]> = {
      2: "raid",
      5: "raid",
      7: "scout",
      10: "raid",
      11: "curse",
      12: "scout",
      13: "raid",
      16: "scout",
      19: "raid",
      21: "rest",
    };
    const v = aiView(s, p.id);
    const r = RECIPES.find(
      (r) => canRecipe(p, r.id, s.day) && materialIds(p, r.materials),
    );
    const target = p.longGoal.targets[0] ?? v.others[0].id;
    const opponent = v.others.find((q) => q.id === target)!;
    const power =
      STATS.reduce((n, k) => n + p.stats[k], 0) /
      STATS.reduce((n, k) => n + opponent.stats[k], 0);
    const kinds = [
      ...new Set(
        [
          daily[p.dailyGoal.id],
          p.longGoal.achieved ? undefined : long[p.longGoal.id],
          "rest",
          ...(r ? ["brew"] : []),
          "curse",
          ...(power > 1.15 ? ["raid"] : []),
        ].filter(Boolean),
      ),
    ] as Night["kind"][];
    const candidates = kinds
      .filter(
        (kind) =>
          (kind !== "raid" || p.lastRaid !== s.day - 1) &&
          (kind !== "brew" || r),
      )
      .map((kind) => ({
        action: {
          type: "night",
          player: p.id,
          choice: { kind, target, recipe: r?.id },
        } as Action,
        weight:
          (kind === daily[p.dailyGoal.id] ? AI_POLICY.goalWeight : 1) +
          (kind === long[p.longGoal.id] && !p.longGoal.achieved
            ? AI_POLICY.goalWeight
            : 0) +
          (kind === "rest"
            ? level(p.stats.defense)
            : kind === "raid"
              ? power * 2
              : kind === "curse"
                ? opponent.fp / 5
                : 0),
        reason: `HO進捗・公開能力比${power.toFixed(2)}・休息Lv${level(p.stats.defense)}`,
      }));
    const selected = weightedAction(s, candidates).action as Extract<
      Action,
      { type: "night" }
    >;
    kind = selected.choice.kind;
    if (kind === "brew") {
      const copy = structuredClone(p);
      const plan: string[] = [];
      for (const rec of RECIPES) {
        if (!canRecipe(copy, rec.id, s.day)) continue;
        let ids;
        while ((ids = materialIds(copy, rec.materials))) {
          consume(copy, ids);
          plan.push(rec.id);
        }
      }
      selected.choice = { kind: "brew", recipes: plan };
    }
    nightChoice(s, p, selected.choice);
    log(s, "aiReason", `AI ${p.name}：自身のHOとCDから${LABELS[kind]}`, {
      actor: p.id,
      audience: "dev",
    });
  }
}
function apply(s: GameState, a: Action) {
  if (a.type === "advance") {
    advance(s);
    return;
  }
  if (a.type === "aiPublic") {
    runPublicAI(s);
    return;
  }
  const p = s.players[a.player];
  assert(p, "席が不正");
  assert(s.phase !== "ended", "終了済みです");
  if (s.challenge && a.type !== "challengeReply")
    throw Error("挑戦への返答を完了してください");
  if (s.combat && !["round", "loadout", "reward"].includes(a.type))
    throw Error("戦闘中です");
  switch (a.type) {
    case "endTurn":
      endTurn(s, p);
      break;
    case "forced":
      forced(s, p, a.kind, a.stat);
      break;
    case "gather": {
      publicAction(s, p);
      const bonus = used(s, p, a.potion, "gather");
      const curse = ap(s, p);
      const n = Math.max(0, 2 + p.rest + bonus - curse);
      const items = [];
      for (let i = 0; i < n; i++)
        items.push(addItem(s, p, pick(s, MATERIALS, "採集素材")).kind);
      log(s, "gather", `${p.name}が素材${n}個を採集`, {
        actor: p.id,
        amount: n,
      });
      log(s, "gatherItems", items.map((i) => LABELS[i]).join("・"), {
        actor: p.id,
        audience: [p.id],
      });
      break;
    }
    case "research": {
      publicAction(s, p);
      assert(STATS.includes(a.stat), "能力が不正");
      const ids = materialIds(p, RESEARCH[a.stat]);
      assert(ids, "研究素材不足または予約中");
      const bonus = used(s, p, a.potion, "research");
      consume(p, ids);
      const curse = ap(s, p);
      const growth = Math.max(0, 1 + p.rest + bonus - curse);
      p.stats[a.stat] += growth;
      log(s, "research", `${p.name}が${LABELS[a.stat]}を研究 +${growth}`, {
        actor: p.id,
        kind: a.stat,
        amount: growth,
      });
      break;
    }
    case "brew":
      throw Error("公開錬金は廃止されました。夜の錬金を選択してください");
    case "reserve":
      publicAction(s, p, 0);
      reserve(s, p, a.items, a.stats);
      break;
    case "withdraw":
      publicAction(s, p, 0);
      withdraw(s, p);
      break;
    case "shop": {
      publicAction(s, p);
      assert(
        a.items.length === 3 &&
          a.items.every((id) =>
            isMaterial(p.inventory.find((i) => i.id === id)?.kind ?? ""),
          ) &&
          MATERIALS.includes(a.receive),
        "購買部は素材3→1",
      );
      consume(p, a.items);
      ap(s, p);
      addItem(s, p, a.receive);
      log(s, "shop", `${p.name}が購買部で素材3個を1個に交換（1AP）`, {
        actor: p.id,
      });
      log(s, "shopItems", `受領：${LABELS[a.receive]}`, {
        actor: p.id,
        audience: [p.id],
      });
      break;
    }
    case "trade": {
      publicAction(s, p, 0);
      assert(s.publicTurn.round <= 2, "最終納品確認では取引申請できません");
      const key = `${s.publicTurn.round}:${p.id}:${a.target}`;
      assert(
        (s.publicTurn.tradeAttempts[key] ?? 0) < 2,
        "同じ相手への申請は1巡2回までです",
      );
      assert(a.target !== p.id && s.players[a.target], "取引対象が不正");
      assert(!s.trades.some((t) => t.from === p.id), "送信中の取引があります");
      assert(
        Object.entries(a.request).every(
          ([k, n]) =>
            (isMaterial(k) || recipe(k)) && Number.isSafeInteger(n) && n >= 0,
        ),
        "要求数が不正",
      );
      assert(
        a.offer.length + Object.values(a.request).reduce((n, v) => n + v, 0) >
          0,
        "空の取引は不可",
      );
      assert(
        new Set(a.offer).size === a.offer.length &&
          a.offer.every((id) => available(p).some((i) => i.id === id)),
        "提供品不足",
      );
      s.publicTurn.tradeAttempts[key] =
        (s.publicTurn.tradeAttempts[key] ?? 0) + 1;
      const id = s.nextTrade++;
      const t = {
        id,
        from: p.id,
        to: a.target,
        offer: [...a.offer],
        request: { ...a.request },
      };
      a.offer.forEach(
        (id) => (p.inventory.find((i) => i.id === id)!.lock = `trade:${t.id}`),
      );
      s.trades.push(t);
      const q = s.players[a.target];
      if (q.ai) {
        const needed =
          [2, 7, 8, 12, 18].includes(q.longGoal.id) ||
          [8, 9, 10, 23].includes(q.dailyGoal.id);
        replyTrade(
          s,
          q,
          id,
          a.offer.length >=
            Object.values(a.request).reduce((n, v) => n + v, 0) || needed,
        );
      }
      break;
    }
    case "tradeReply":
      assert(
        s.phase === "public" && !s.combat && !s.challenge,
        "取引へ返答できません",
      );
      replyTrade(s, p, a.id, a.accept);
      break;
    case "tradeCancel": {
      assert(
        s.phase === "public" && !s.combat && !s.challenge,
        "取引を撤回できません",
      );
      const t = s.trades.find((t) => t.id === a.id && t.from === p.id);
      assert(t, "撤回できる取引なし");
      s.trades = s.trades.filter((t) => t.id !== a.id);
      p.inventory.forEach((i) => {
        if (i.lock === `trade:${a.id}`) delete i.lock;
      });
      log(s, "tradeCancelled", "取引申請を撤回しました", {
        actor: p.id,
        target: t.to,
        audience: [p.id, t.to],
      });
      break;
    }
    case "duel":
      publicAction(s, p, a.mock ? 0 : 2);
      assert(
        a.mock ? s.publicTurn.round <= 2 : s.publicTurn.round === 1,
        "決闘は通常行動の巡目で実行してください",
      );
      assert(a.target !== p.id && s.players[a.target], "対戦対象が不正");
      if (a.mock)
        assert(
          EVENTS[s.event.id - 1].mock && !s.event.mock.length,
          "模擬戦は対象イベント1回のみ",
        );
      else ap(s, p, 2);
      cancelTrades(s);
      if (!s.players[a.target].ai) {
        s.challenge = { from: p.id, to: a.target, mock: !!a.mock };
      } else {
        startCombat(s, p.id, a.target, a.mock ? "mock" : "public");
        autoCombats(s);
      }
      break;
    case "challengeReply": {
      const ch = s.challenge;
      assert(ch && ch.to === p.id, "挑戦を受けていません");
      if (a.fight) {
        s.challenge = undefined;
        startCombat(s, ch.from, ch.to, ch.mock ? "mock" : "public");
      } else if (ch.mock) {
        s.challenge = undefined;
      } else {
        const ids = a.items ?? [];
        const items = ids.map((id) => available(p).find((i) => i.id === id));
        assert(
          new Set(ids).size === ids.length &&
            items.every(Boolean) &&
            ((items.length === 2 && items.every((i) => isMaterial(i!.kind))) ||
              (items.length === 1 && items.every((i) => !isMaterial(i!.kind)))),
          "降参には未予約の素材2個または薬1個が必要",
        );
        transfer(s, p, s.players[ch.from], ids, "surrender");
        s.challenge = undefined;
        log(s, "surrender", "降参品を渡して挑戦を終了", {
          actor: p.id,
          target: ch.from,
          audience: [p.id, ch.from],
        });
      }
      break;
    }
    case "loadout":
      loadout(s, p, a.items);
      break;
    case "round":
      combatRound(s, p, a);
      break;
    case "reward":
      applyReward(s, p, a.kind, a.stat);
      break;
    case "magic":
      magic(s, p, a.target);
      break;
    case "vote":
      assert(
        s.phase === "vote" &&
          p.activeMagic &&
          p.magic === "foresight" &&
          s.foresight.includes(a.event) &&
          s.votes[p.id] === undefined,
        "投票不可",
      );
      s.votes[p.id] = a.event;
      break;
    case "night":
      nightChoice(s, p, a.choice);
      break;
    case "usePotion": {
      if (s.phase === "public") publicAction(s, p, 0);
      assert(s.phase === "public" || s.phase === "magic", "薬の使用フェーズ外");
      const i = p.inventory.find((i) => i.id === a.item && !i.lock);
      assert(i, "薬がありません");
      if (i.kind === "purify") {
        used(s, p, i.id, "cleanse");
        p.curse = 0;
        p.immune = true;
      } else if (i.kind === "talent") {
        assert(
          s.phase === "magic" &&
            s.day < 8 &&
            !p.changedMagic &&
            a.magic &&
            a.magic !== p.magic &&
            MAGICS[a.magic],
          "才能変化できません",
        );
        used(s, p, i.id, "change");
        p.nextMagic = a.magic;
        p.changedMagic = true;
      } else throw Error("この薬は対象行動と同時に選択してください");
      break;
    }
    case "unlock":
      assert(
        p.pendingRecipe &&
          RECIPES.some((r) => r.id === a.recipe && r.tier === "special") &&
          !p.recipes.includes(a.recipe),
        "解放候補が不正",
      );
      p.recipes.push(a.recipe);
      p.pendingRecipe = false;
      log(s, "unlock", `${recipe(a.recipe)!.name}のレシピを解放`, {
        actor: p.id,
        kind: a.recipe,
        audience: [p.id],
      });
      break;
  }
}
// AIへの入力を公開情報と本人私有情報から明示構築。相手inventory/HO/magicは渡さない。
export function aiView(s: GameState, id: number) {
  return {
    day: s.day,
    failed: s.failed,
    event: structuredClone(s.event),
    eventDefinition: EVENTS[s.event.id - 1],
    progress: eventProgress(s),
    self: structuredClone(s.players[id]),
    others: s.players
      .filter((p) => p.id !== id)
      .map((p) => ({
        id: p.id,
        name: p.name,
        stats: { ...p.stats },
        fp: p.fp,
        ap: p.ap,
      })),
    publicLogs: s.logs.filter((l) => l.audience === "public"),
  };
}
function autoReserve(s: GameState, p: Player) {
  const v = aiView(s, p.id),
    e = v.eventDefinition,
    pr = v.progress;
  const ids = donationItems(s, p);
  const stats: Partial<Record<Stat, number>> = {};
  let need = (e.stats ?? 0) - pr.stats;
  if (
    e.stats &&
    (!e.either || pr.materials + ids.length < (e.materials ?? 0))
  ) {
    for (const k of STATS) {
      const locked = s.event.reservations
        .filter((r) => r.player === p.id)
        .reduce((n, r) => n + (r.stats[k] ?? 0), 0);
      const n = Math.min(need, p.stats[k] - locked - 1);
      if (n > 0) {
        stats[k] = n;
        need -= n;
      }
    }
  }
  if (ids.length || Object.values(stats).some((n) => n))
    reserve(s, p, ids, stats);
}
export function currentPlayer(s: GameState) {
  return s.publicTurn.round <= 3
    ? s.publicTurn.order[s.publicTurn.index]
    : undefined;
}
function endTurn(s: GameState, p: Player) {
  publicAction(s, p, 0);
  assert(
    s.publicTurn.round === 3 || s.publicTurn.acted || !p.commands.length,
    "先に命令のAPを実行してください",
  );
  log(
    s,
    "turnEnd",
    `${p.name}：${s.publicTurn.round === 3 ? "最終納品確認" : `${s.publicTurn.round}巡目・${s.publicTurn.acted ? "手番終了" : p.ap === 0 ? "通常行動スキップ（APなし）" : "パス"}`}`,
    { actor: p.id, data: { round: s.publicTurn.round, remainingAP: p.ap } },
  );
  const t = s.publicTurn;
  t.index++;
  if (t.index === 4) {
    t.index = 0;
    t.round++;
  }
  t.acted = false;
  t.aiTradeAttempted = false;
  t.aiMockAttempted = false;
}
function runPublicAI(s: GameState) {
  // Each iteration advances a finite turn or stops at a human decision.
  for (let steps = 0; steps < 20; steps++) {
    if (
      s.phase !== "public" ||
      s.combat ||
      s.challenge ||
      s.trades.length ||
      s.players.some((p) => p.pendingRecipe)
    )
      return;
    const id = currentPlayer(s);
    if (id === undefined) return;
    const p = s.players[id],
      t = s.publicTurn;
    if (t.round <= 2 && p.ap === 0 && !t.acted) {
      endTurn(s, p);
      continue;
    }
    if (!p.ai) return;
    autoReserve(s, p);
    if (t.round === 3) {
      endTurn(s, p);
      continue;
    }
    if (t.acted) {
      endTurn(s, p);
      continue;
    }
    if (p.commands.length) {
      const stat = STATS.find((k) => materialIds(p, RESEARCH[k]));
      forced(s, p, stat ? "research" : "gather", stat);
      t.acted = true;
      autoReserve(s, p);
      continue;
    }
    if (
      EVENTS[s.event.id - 1].mock &&
      !s.event.mock.length &&
      !t.aiMockAttempted
    ) {
      t.aiMockAttempted = true;
      startCombat(
        s,
        p.id,
        s.players.find((q) => q.ai && q.id !== p.id)!.id,
        "mock",
      );
      autoCombats(s);
      if (s.combat) return;
    }
    const tradeGoal =
      (AI_POLICY.goalTradeDaily as readonly number[]).includes(
        p.dailyGoal.id,
      ) ||
      (AI_POLICY.goalTradeLong as readonly number[]).includes(p.longGoal.id);
    if (!t.aiTradeAttempted && tradeGoal) {
      t.aiTradeAttempted = true;
      const item = available(p).find((i) =>
        p.longGoal.id === 8 ? !isMaterial(i.kind) : true,
      );
      if (item) {
        apply(s, {
          type: "trade",
          player: p.id,
          target:
            p.longGoal.targets[0] ?? s.players.find((q) => q.id !== p.id)!.id,
          offer: [item.id],
          request: {},
        });
        if (s.trades.length) return;
      }
    }
    const stat = STATS.find((k) => materialIds(p, RESEARCH[k]));
    const duelGoal =
      (AI_POLICY.goalDuelDaily as readonly number[]).includes(p.dailyGoal.id) ||
      (AI_POLICY.goalDuelLong as readonly number[]).includes(p.longGoal.id);
    const e = EVENTS[s.event.id - 1];
    const candidates: { action: Action; weight: number; reason: string }[] = [
      {
        action: { type: "gather", player: p.id },
        weight: 1,
        reason: "素材確保",
      },
    ];
    const cooperation =
      s.failed >= 2 ? CONFIG.aiCrisisCooperation : CONFIG.aiCooperation;
    if (stat)
      candidates.push({
        action: { type: "research", player: p.id, stat },
        weight:
          e.actions?.includes("research") && !eventProgress(s).success
            ? cooperation
            : AI_POLICY.growthWeight,
        reason: "公開能力の育成",
      });
    if (
      duelGoal &&
      t.round === 1 &&
      p.ap === 2 &&
      s.failed < 2 &&
      !e.actions &&
      !e.potions
    )
      candidates.push({
        action: {
          type: "duel",
          player: p.id,
          target:
            p.longGoal.targets[0] ??
            s.players.find((q) => q.ai && q.id !== p.id)!.id,
        },
        weight: 5,
        reason: "自身のHO",
      });
    const selected = weightedAction(s, candidates);
    apply(s, selected.action);
    if (s.combat || s.challenge) return;
    autoReserve(s, p);
    endTurn(s, p);
  }
  throw Error("公開手番の進行上限を超えました");
}
export function dispatch(state: GameState, action: Action): GameState {
  const s = structuredClone(state);
  const actor = "player" in action ? s.players[action.player] : undefined;
  const beforeProgress =
    s.phase === "public" ? structuredClone(eventProgress(s)) : undefined;
  apply(s, structuredClone(action));
  if (
    beforeProgress &&
    s.phase === "public" &&
    JSON.stringify(beforeProgress) !== JSON.stringify(eventProgress(s))
  )
    log(
      s,
      "eventProgress",
      `イベント進捗更新：素材${eventProgress(s).materials}・薬${eventProgress(s).potions}・能力${eventProgress(s).stats}・行動${eventProgress(s).actions}`,
      { actor: actor?.id },
    );
  runPublicAI(s);
  s.revision++;
  s.actions.push(structuredClone(action));
  assertInvariants(s);
  return s;
}
export function assertInvariants(s: GameState) {
  assert(
    s.version === 2 && s.rulesVersion === CONFIG.rulesVersion,
    "状態のバージョンが一致しません",
  );
  assert(s.players.length === 4, "4席であること");
  const t = s.publicTurn;
  assert(
    t &&
      t.order.length === 4 &&
      new Set(t.order).size === 4 &&
      t.order.every((id) => Number.isInteger(id) && id >= 0 && id < 4),
    "手番順が不正です",
  );
  assert(
    Number.isInteger(t.index) &&
      t.index >= 0 &&
      t.index < 4 &&
      Number.isInteger(t.round) &&
      t.round >= 1 &&
      t.round <= 4,
    "巡目・手番が不正です",
  );
  assert(
    [t.acted, t.aiTradeAttempted, t.aiMockAttempted].every(
      (v) => typeof v === "boolean",
    ),
    "手番状態が不正です",
  );
  assert(
    s.trades.length <= 1 &&
      s.trades.every((trade) => trade.from === currentPlayer(s)),
    "未決取引と手番が一致しません",
  );
  assert(
    Object.values(t.tradeAttempts).every(
      (n) => Number.isInteger(n) && n >= 0 && n <= 2,
    ),
    "取引申請回数が不正です",
  );
  assert(s.day >= 1 && s.day <= 8, "日数が不正");
  const ids = s.players
    .flatMap((p) => p.inventory.map((i) => i.id))
    .concat(s.combat?.brought.flat().map((i) => i.id) ?? []);
  assert(ids.length === new Set(ids).size, "アイテムID重複");
  for (const p of s.players) {
    assert(Number.isInteger(p.ap) && p.ap >= 0 && p.ap <= 2, "AP範囲");
    assert(Number.isInteger(p.fp) && p.fp >= 0, "FP下限");
    for (const k of STATS)
      assert(Number.isInteger(p.stats[k]) && p.stats[k] >= 1, "能力下限");
  }
}
