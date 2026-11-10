import type {
  EventDefinition,
  GameState,
  Player,
  Reservation,
  Stat,
} from "./types";
import { MATERIALS, STATS, LEGACY_RULES_VERSION, isV20 } from "./config";
import { isMaterial, addItem, available } from "./items";
import { pick, random } from "./rng";
import { fp, log } from "./core";
export const EVENTS: EventDefinition[] = [
  {
    id: 1,
    name: "魔力灯の修理",
    difficulty: "Easy",
    description: "任意素材4個を納品",
    materials: 4,
    fp: 1,
  },
  {
    id: 2,
    name: "使い魔の大脱走",
    difficulty: "Easy",
    description: "月光草または星の砂を合計4個",
    materials: 4,
    allowed: ["herb", "sand"],
    fp: 1,
  },
  {
    id: 3,
    name: "魔導書の整理整頓",
    difficulty: "Easy",
    description: "採集・研究の成立回数が全体で4回以上",
    actions: ["gather", "research"],
    count: 4,
    fp: 1,
  },
  {
    id: 4,
    name: "公開模擬戦",
    difficulty: "Easy",
    description: "異なる2人で模擬戦を完了。成功時、参加者に素材2個",
    mock: true,
    fp: 0,
  },
  {
    id: 5,
    name: "月光炉の暴走",
    difficulty: "Normal",
    description: "素材6個（月光草・精霊水を各1個以上）",
    materials: 6,
    required: { herb: 1, water: 1 },
    fp: 1,
  },
  {
    id: 6,
    name: "封印陣の亀裂",
    difficulty: "Normal",
    description: "恒久能力を合計4ポイント納品",
    stats: 4,
    fp: 2,
  },
  {
    id: 7,
    name: "魔法薬の品質検査",
    difficulty: "Normal",
    description: "完成済み薬4個を納品",
    potions: 4,
    fp: 1,
  },
  {
    id: 8,
    name: "星読みの儀式",
    difficulty: "Normal",
    description: "素材6個（星の砂1個以上）。最多寄付者にFP",
    materials: 6,
    required: { sand: 1 },
    fp: 1,
    most: true,
  },
  {
    id: 9,
    name: "魔女評議会の査察",
    difficulty: "Normal",
    description: "研究成立回数が全体で4回以上",
    actions: ["research"],
    count: 4,
    fp: 1,
  },
  {
    id: 10,
    name: "古代魔導書の覚醒",
    difficulty: "Hard",
    description: "任意素材8個＋異なる2人で模擬戦完了",
    materials: 8,
    mock: true,
    fp: 1,
  },
  {
    id: 11,
    name: "異界門の開放",
    difficulty: "Hard",
    description: "能力4ポイント＋公開時指定素材4個",
    materials: 4,
    stats: 4,
    fp: 2,
  },
  {
    id: 12,
    name: "研究所崩壊の危機",
    difficulty: "Hard",
    description: "任意素材8個 または 能力5ポイント（先着ルート）",
    materials: 8,
    stats: 5,
    either: true,
    fp: 2,
  },
];
export function eligibleEvents(
  s: GameState,
  day: number,
  excluded: number[] = [],
) {
  return EVENTS.filter(
    (e) =>
      !s.usedEvents.includes(e.id) &&
      !excluded.includes(e.id) &&
      (day !== 1 || !e.potions || s.rulesVersion === LEGACY_RULES_VERSION),
  );
}
export function drawEvent(s: GameState, day: number, excluded: number[] = []) {
  const pool = eligibleEvents(s, day, excluded);
  if (!pool.length) throw Error("抽選候補がありません");
  const weights = day <= 4 ? [45, 45, 10] : [5, 45, 50];
  const ds = ["Easy", "Normal", "Hard"];
  const valid = ds.map((d, i) => ({
    d,
    w: pool.some((e) => e.difficulty === d) ? weights[i] : 0,
  }));
  let n = random(s) * valid.reduce((a, v) => a + v.w, 0);
  const d =
    valid.find((v) => {
      n -= v.w;
      return n < 0;
    })?.d ?? pool[0]?.difficulty;
  return pick(
    s,
    pool.filter((e) => e.difficulty === d),
    "イベント抽選",
  ).id;
}
export function startEvent(s: GameState) {
  const id = s.nextEvent ?? drawEvent(s, s.day);
  s.nextEvent = undefined;
  s.usedEvents.push(id);
  s.event = {
    id,
    specified: isV20(s)
      ? id === 11
        ? pick(s, MATERIALS, "異界門指定素材")
        : "obsidian"
      : pick(s, MATERIALS.slice(0, 5), "異界門指定素材"),
    reservations: [],
    mock: [],
    resolved: false,
  };
  log(s, "event", `第${s.day}日：${EVENTS[id - 1].name}`);
}
export function eventProgress(s: GameState) {
  if (s.event.resolved && s.event.finalProgress) return s.event.finalProgress;
  const e = EVENTS[s.event.id - 1];
  const items = s.event.reservations.flatMap((r) =>
    r.items.map((id) =>
      s.players[r.player].inventory.find((i) => i.id === id)!,
    ),
  );
  const materials = items.filter((i) => isMaterial(i.kind));
  const potions = items.length - materials.length;
  const stats = s.event.reservations.reduce(
    (n, r) => n + Object.values(r.stats).reduce((a, b) => a + (b ?? 0), 0),
    0,
  );
  const counts: Record<string, number> = {};
  materials.forEach((i) => (counts[i.kind] = (counts[i.kind] ?? 0) + 1));
  const actions = s.logs.filter(
    (l) => l.day === s.day && e.actions?.includes(l.type),
  ).length;
  const enough = (n: number, required: number) =>
    isV20(s) ? n >= required : n === required;
  const materialOk =
    enough(materials.length, e.materials ?? 0) &&
    Object.entries(e.required ?? {}).every(([k, v]) => (counts[k] ?? 0) >= v);
  const statOk = enough(stats, e.stats ?? 0);
  const other =
    (!e.mock || s.event.mock.length === 2) &&
    (!e.actions || actions >= (e.count ?? 0)) &&
    (!e.potions || enough(potions, e.potions));
  const success =
    other &&
    (e.either
      ? s.event.route === "materials"
        ? materialOk
        : s.event.route === "stats"
          ? statOk
          : materialOk || statOk
      : materialOk && statOk);
  return {
    materials: materials.length,
    potions,
    stats,
    counts,
    actions,
    success,
  };
}
export function reservationUnits(s: GameState, p: Player) {
  return s.event.reservations
    .filter((r) => r.player === p.id)
    .reduce(
      (n, r) =>
        n +
        r.items.length +
        Object.values(r.stats).reduce((a, b) => a + (b ?? 0), 0),
      0,
    );
}
export function reservationRoom(s: GameState, p: Player) {
  return !isV20(s) && s.phase === "public" && s.publicTurn.round === 1
    ? Math.max(0, 1 - reservationUnits(s, p))
    : Infinity;
}
export function reserve(
  s: GameState,
  p: Player,
  ids: number[],
  stats: Partial<Record<Stat, number>>,
) {
  const e = EVENTS[s.event.id - 1];
  if (new Set(ids).size !== ids.length) throw Error("重複アイテム");
  for (const [k, v] of Object.entries(stats)) {
    if (!STATS.includes(k as Stat) || !Number.isInteger(v) || v < 0)
      throw Error("能力予約が不正です");
  }
  const items = ids.map((id) => {
    const i = p.inventory.find((i) => i.id === id && !i.lock);
    if (!i) throw Error("所持不足または予約中");
    return i;
  });
  if (
    items.some((i) =>
      isMaterial(i.kind)
        ? !e.materials ||
          (e.allowed && !e.allowed.includes(i.kind)) ||
          (e.id === 11 && i.kind !== s.event.specified)
        : !e.potions,
    )
  )
    throw Error("対象外の納品物");
  const before = eventProgress(s);
  const ns = Object.values(stats).reduce((a, b) => a + (b ?? 0), 0);
  if (ids.length + ns > reservationRoom(s, p))
    throw Error(
      "第1巡の納品予約は1人1個までです（素材・薬・能力1ポイントを合算）",
    );
  if (ns && !e.stats) throw Error("能力納品の対象外");
  for (const k of STATS) {
    const reserved = s.event.reservations
      .filter((r) => r.player === p.id)
      .reduce((n, r) => n + (r.stats[k] ?? 0), 0);
    if (p.stats[k] - reserved - (stats[k] ?? 0) < 1)
      throw Error("能力下限は1です");
  }
  if (
    !isV20(s) &&
    (before.materials + items.filter((i) => isMaterial(i.kind)).length >
      (e.materials ?? 0) ||
      before.potions + items.filter((i) => !isMaterial(i.kind)).length >
        (e.potions ?? 0) ||
      before.stats + ns > (e.stats ?? 0))
  )
    throw Error("必要数を超える納品です");
  items.forEach((i) => (i.lock = "event"));
  s.event.reservations.push({ player: p.id, items: ids, stats });
  if (e.either && !s.event.route) {
    const now = eventProgress(s);
    if (now.materials >= (e.materials ?? Infinity)) s.event.route = "materials";
    else if (now.stats >= (e.stats ?? Infinity)) s.event.route = "stats";
  }
  const progress = eventProgress(s);
  log(
    s,
    "reserve",
    `${p.name}が納品を予約：素材+${items.filter((i) => isMaterial(i.kind)).length}・薬+${items.filter((i) => !isMaterial(i.kind)).length}・能力+${ns}（合計 素材${progress.materials}・薬${progress.potions}・能力${progress.stats}）`,
    {
      actor: p.id,
      data: {
        items: items.map((i) => i.kind),
        stats,
        round: s.publicTurn.round,
        units: ids.length + ns,
      },
    },
  );
}
export function withdraw(s: GameState, p: Player) {
  p.inventory.forEach((i) => {
    if (i.lock === "event") delete i.lock;
  });
  s.event.reservations = s.event.reservations.filter((r) => r.player !== p.id);
  const e = EVENTS[s.event.id - 1];
  if (e.either && isV20(s)) {
    const pr = eventProgress(s);
    const materials = pr.materials >= e.materials!;
    const stats = pr.stats >= e.stats!;
    if (
      !(s.event.route === "materials" && materials) &&
      !(s.event.route === "stats" && stats)
    )
      s.event.route = materials ? "materials" : stats ? "stats" : undefined;
  } else if (e.either) {
    const pr = eventProgress(s);
    if (
      (s.event.route === "materials" && pr.materials !== e.materials) ||
      (s.event.route === "stats" && pr.stats !== e.stats)
    )
      s.event.route = undefined;
  }
  log(s, "withdraw", `${p.name}が納品予約を撤回`, { actor: p.id });
}
function adoptedReservations(s: GameState, e: EventDefinition): Reservation[] {
  const reservations = s.event.reservations;
  const items = reservations.flatMap((r) =>
    r.items.map((id) =>
      s.players[r.player].inventory.find((i) => i.id === id)!,
    ),
  );
  const adopted = new Set<number>();
  const itemLimit =
    e.either && s.event.route === "stats" ? 0 : (e.materials ?? e.potions ?? 0);
  for (const [kind, count] of Object.entries(e.required ?? {}))
    for (const item of items.filter((i) => i.kind === kind).slice(0, count))
      adopted.add(item.id);
  for (const item of items) {
    if (adopted.size >= itemLimit) break;
    adopted.add(item.id);
  }
  let remaining =
    e.either && s.event.route === "materials" ? 0 : (e.stats ?? 0);
  return reservations.map((r) => {
    const stats: Partial<Record<Stat, number>> = {};
    for (const kind of STATS) {
      const amount = Math.min(remaining, r.stats[kind] ?? 0);
      if (amount) stats[kind] = amount;
      remaining -= amount;
    }
    return {
      player: r.player,
      items: r.items.filter((id) => adopted.has(id)),
      stats,
    };
  });
}

export function resolveEvent(s: GameState) {
  if (s.event.resolved) throw Error("イベント判定済み");
  const e = EVENTS[s.event.id - 1];
  const finalProgress = eventProgress(s);
  const success = finalProgress.success;
  s.event.finalProgress = structuredClone(finalProgress);
  s.event.success = success;
  s.event.resolved = true;
  if (!success) s.failed++;
  const donations = new Map<number, number>();
  for (const r of isV20(s) && success
    ? adoptedReservations(s, e)
    : s.event.reservations) {
    const p = s.players[r.player];
    const ids = r.items.filter(
      (id) => !e.either || s.event.route === "materials",
    );
    const n =
      ids.length +
      (!e.either || s.event.route === "stats"
        ? Object.values(r.stats).reduce((a, b) => a + (b ?? 0), 0)
        : 0);
    if (n) donations.set(p.id, (donations.get(p.id) ?? 0) + n);
    if (success) {
      p.inventory = p.inventory.filter((i) => !ids.includes(i.id));
      if (!e.either || s.event.route === "stats")
        for (const k of STATS) {
          const amount = r.stats[k] ?? 0;
          p.stats[k] -= amount;
          if (amount)
            log(
              s,
              "statDonation",
              `${p.name}が${k === "attack" ? "攻撃" : k === "defense" ? "防御" : "洞察"}を${amount}納品（恒久値−${amount}）`,
              { actor: p.id, kind: k, amount: -amount },
            );
        }
    }
    p.inventory.forEach((i) => {
      if (i.lock === "event") delete i.lock;
    });
  }
  if (success) {
    const contributors = new Set(donations.keys());
    s.logs
      .filter((l) => l.day === s.day && e.actions?.includes(l.type))
      .forEach((l) => contributors.add(l.actor!));
    s.event.mock.forEach((id) => contributors.add(id));
    for (const p of s.players) {
      if (contributors.has(p.id))
        log(s, "contribution", `${p.name}：イベント有効貢献`, {
          actor: p.id,
          amount: 1,
        });
      const donated = donations.get(p.id) ?? 0;
      const reward = e.most
        ? donated > 0 && donated === Math.max(...donations.values())
        : e.mock && !e.materials
          ? false
          : e.actions
            ? contributors.has(p.id)
            : donated > 0;
      if (reward) fp(s, p, e.fp, "event", { eventId: e.id });
      if (s.event.mock.includes(p.id))
        for (let n = 0; n < 2; n++)
          addItem(s, p, pick(s, MATERIALS, "模擬戦報酬"));
    }
  }
  log(
    s,
    "eventResult",
    `${e.name}：${success ? "成功" : "失敗"}（失敗 ${s.failed}/3）`,
    { data: { success, event: e.id } },
  );
  s.event.reservations = [];
}

/** 必須素材の不足分の枠を残す、公開情報と本人所持だけによる納品候補。 */
export function donationItems(s: GameState, p: Player): number[] {
  const e = EVENTS[s.event.id - 1],
    pr = eventProgress(s);
  const pool = available(p);
  if (e.potions)
    return pool
      .filter((i) => !isMaterial(i.kind))
      .slice(
        0,
        Math.max(0, Math.min(e.potions - pr.potions, reservationRoom(s, p))),
      )
      .map((i) => i.id);
  if (!e.materials) return [];
  const eligible = pool.filter(
    (i) =>
      isMaterial(i.kind) &&
      (!e.allowed || e.allowed.includes(i.kind)) &&
      (e.id !== 11 || i.kind === s.event.specified),
  );
  const selected: number[] = [];
  let missing = 0;
  for (const [kind, total] of Object.entries(e.required ?? {})) {
    const need = Math.max(0, total - (pr.counts[kind] ?? 0));
    const matches = eligible.filter((i) => i.kind === kind).slice(0, need);
    selected.push(...matches.map((i) => i.id));
    missing += need - matches.length;
  }
  const room = Math.max(0, e.materials - pr.materials - missing);
  for (const i of eligible)
    if (selected.length < room && !selected.includes(i.id)) selected.push(i.id);
  return selected.slice(
    0,
    Math.min(reservationRoom(s, p), Math.max(0, e.materials - pr.materials)),
  );
}
