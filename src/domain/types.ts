export type Stat = "attack" | "defense" | "insight";
export type Stats = Record<Stat, number>;
export type Magic = "foresight" | "illusion" | "barrier" | "shadow" | "alchemy";
export type NightKind = "raid" | "curse" | "guard" | "rest" | "brew" | "scout";
export type Stance = "attack" | "defend" | "charge";
export type Phase =
  | "public"
  | "magic"
  | "vote"
  | "night"
  | "duels"
  | "rewards"
  | "results"
  | "ho"
  | "dawn"
  | "ended";
export interface Item {
  id: number;
  kind: string;
  lock?: string;
}
export interface Goal {
  id: number;
  targets: number[];
  achieved: boolean;
}
export interface Night {
  kind: NightKind;
  target?: number;
  recipe?: string;
  recipes?: string[];
  potion?: number;
}
export interface Player {
  id: number;
  name: string;
  ai: boolean;
  stats: Stats;
  ap: number;
  fp: number;
  peakFp: number;
  inventory: Item[];
  magic: Magic;
  availableDay: number;
  activeMagic: boolean;
  longGoal: Goal;
  dailyGoal: Goal;
  dailyHistory: { day: number; id: number; achieved: boolean }[];
  recipes: string[];
  unlocks: number[];
  pendingRecipe: boolean;
  temporaryRecipe?: { kind: string; day: number };
  rest: number;
  curse: number;
  immune: boolean;
  lastRaid: number;
  night?: Night;
  commands: { from: number }[];
  nextMagic?: Magic;
  changedMagic: boolean;
}
export interface Log {
  seq: number;
  day: number;
  phase: Phase;
  type: string;
  actor?: number;
  target?: number;
  amount?: number;
  kind?: string;
  data?: Record<string, unknown>;
  audience: "public" | "dev" | number[];
  text: string;
}
export interface EventDefinition {
  id: number;
  name: string;
  difficulty: "Easy" | "Normal" | "Hard";
  description: string;
  materials?: number;
  allowed?: string[];
  required?: Record<string, number>;
  stats?: number;
  potions?: number;
  actions?: string[];
  count?: number;
  mock?: boolean;
  either?: boolean;
  fp: number;
  most?: boolean;
}
export interface Reservation {
  player: number;
  items: number[];
  stats: Partial<Stats>;
}
export interface CurrentEvent {
  finalProgress?: {
    materials: number;
    potions: number;
    stats: number;
    counts: Record<string, number>;
    actions: number;
    success: boolean;
  };
  id: number;
  specified: string;
  reservations: Reservation[];
  mock: number[];
  resolved: boolean;
  success?: boolean;
  route?: "materials" | "stats";
}
export interface Round {
  insight: [number, number];
  nextCharge: [number, number];
  base: [number, number];
  chargeBonus: [number, number];
  buffs: [
    { attack: number; defense: number; charge: number },
    { attack: number; defense: number; charge: number },
  ];
  guard: [number, number];
  counter: [boolean, boolean];
  choices: [Stance, Stance];
  original: [Stance, Stance];
  rolls: [number, number];
  values: [number, number];
  damage: [number, number];
  hp: [number, number];
  potions: [string | null, string | null];
}
export interface Combat {
  id: number;
  participants: [number, number];
  kind: "public" | "secret" | "mock";
  hp: [number, number];
  charge: [number, number];
  previous: [Stance | null, Stance | null];
  brought: [Item[], Item[]];
  rounds: Round[];
  winner?: number | null;
  done: boolean;
  resultAcknowledged: boolean;
  returnPhase: Phase;
  illusionRound: number;
  initiator: number;
}
export interface Trade {
  id: number;
  from: number;
  to: number;
  offer: number[];
  request: Record<string, number>;
}
export interface Result {
  reason: "completed" | "collapse";
  graduates: number[];
  chiefs: number[];
  ranking: {
    player: number;
    rank: number;
    fp: number;
    daily: number;
    graduated: boolean;
  }[];
}
export interface Setup {
  name: string;
  seed: string;
  magic: Magic;
  stats: Stats;
}
export interface GameState {
  version: 2;
  rulesVersion: string;
  setup: Setup;
  seed: string;
  rng: number;
  draws: number;
  day: number;
  phase: Phase;
  players: Player[];
  failed: number;
  usedEvents: number[];
  event: CurrentEvent;
  nextEvent?: number;
  foresight: number[];
  votes: Record<number, number>;
  barriers: number[];
  logs: Log[];
  actions: Action[];
  revision: number;
  nextItem: number;
  nextCombat: number;
  nextTrade: number;
  combat?: Combat;
  challenge?: { from: number; to: number; mock: boolean };
  combatHistory: Combat[];
  duelQueue: [number, number][];
  trades: Trade[];
  result?: Result;
  publicTurn: {
    order: number[];
    index: number;
    round: number;
    acted: boolean;
    aiTradeAttempted: boolean;
    aiMockAttempted: boolean;
    tradeAttempts: Record<string, number>;
  };
}
export type Action =
  | { type: "forced"; player: number; kind: "gather" | "research"; stat?: Stat }
  | { type: "gather"; player: number; potion?: number }
  | { type: "research"; player: number; stat: Stat; potion?: number }
  | { type: "brew"; player: number; recipe: string }
  | { type: "reserve"; player: number; items: number[]; stats: Partial<Stats> }
  | { type: "withdraw"; player: number }
  | { type: "shop"; player: number; items: number[]; receive: string }
  | {
      type: "trade";
      player: number;
      target: number;
      offer: number[];
      request: Record<string, number>;
    }
  | { type: "tradeReply"; player: number; id: number; accept: boolean }
  | { type: "tradeCancel"; player: number; id: number }
  | { type: "duel"; player: number; target: number; mock?: boolean }
  | { type: "challengeReply"; player: number; fight: boolean; items?: number[] }
  | { type: "loadout"; player: number; items: number[] }
  | { type: "round"; player: number; stance: Stance; potion?: number }
  | { type: "combatAck"; player: number }
  | { type: "reward"; player: number; kind: "item" | "command"; stat?: Stat }
  | { type: "magic"; player: number; target?: number }
  | { type: "vote"; player: number; event: number }
  | { type: "night"; player: number; choice: Night }
  | { type: "usePotion"; player: number; item: number; magic?: Magic }
  | { type: "unlock"; player: number; recipe: string }
  | { type: "endTurn"; player: number }
  | { type: "aiPublic" }
  | { type: "advance" };
