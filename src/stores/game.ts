import { captureResult } from "../records/lastResult";
import { useResultsStore } from "./results";
import { defineStore } from "pinia";
import { shallowRef, ref } from "vue";
import type { Action, GameState, Setup } from "../domain/types";
import { createGame, dispatch } from "../domain/reducer";
import {
  V20_PLAYTEST_RULES_VERSION,
  V20_PREVIOUS_RULES_VERSION,
  V20_RELEASE_RULES_VERSION,
  V20_RULES_VERSION,
  V21_RULES_VERSION,
  V20_NPC_RULES_VERSION,
} from "../domain/config";
import { deserialize, serialize } from "../domain/persistence";

const KEY = "majoken-save-rules-2.1";
const V204_KEY = "majoken-save-rules-2.0.4";
const NPC_KEY = "majoken-save-rules-2.0.3";
const PREVIOUS_KEY = "majoken-save-rules-2.0.2";
const PLAYTEST_KEY = "majoken-save-rules-2.0.1";
const RELEASE_KEY = "majoken-save-rules-2.0-final";
const LEGACY_KEYS = [
  "majoken-save-rules-2.0-review",
  "majoken-save-rules-2.0-strategy",
  "majoken-save-rules-2.0-goals",
  "majoken-save-rules-2.0-night",
  "majoken-save-rules-2.0-combat",
  "majoken-save-rules-2.0",
  "majoken-save-v2",
  "majoken-save-v1",
];

function saveKey(rulesVersion: string) {
  if (rulesVersion === V21_RULES_VERSION) return KEY;
  if (rulesVersion === V20_RULES_VERSION) return V204_KEY;
  if (rulesVersion === V20_NPC_RULES_VERSION) return NPC_KEY;
  if (rulesVersion === V20_PREVIOUS_RULES_VERSION) return PREVIOUS_KEY;
  if (rulesVersion === V20_PLAYTEST_RULES_VERSION) return PLAYTEST_KEY;
  if (rulesVersion === V20_RELEASE_RULES_VERSION) return RELEASE_KEY;
}

function hasSave(key: string) {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

export const useGameStore = defineStore("game", () => {
  const state = shallowRef<GameState>();
  const pending = shallowRef<GameState>();
  const error = ref("");
  const notice = ref("");
  const v204RulesSaveAvailable = ref(hasSave(V204_KEY));
  const npcRulesSaveAvailable = ref(hasSave(NPC_KEY));
  const previousSaveAvailable = ref(hasSave(PREVIOUS_KEY));
  const releasedSaveAvailable = ref(hasSave(RELEASE_KEY));
  const playtestSaveAvailable = ref(hasSave(PLAYTEST_KEY));

  let pendingFinished = false;
  function commit(candidate: GameState, finished = false) {
    try {
      const key = saveKey(candidate.rulesVersion)!;
      localStorage.setItem(key, serialize(candidate));
      if (key === V204_KEY) v204RulesSaveAvailable.value = true;
      if (key === NPC_KEY) npcRulesSaveAvailable.value = true;
      if (key === PREVIOUS_KEY) previousSaveAvailable.value = true;
      if (key === PLAYTEST_KEY) playtestSaveAvailable.value = true;
      if (key === RELEASE_KEY) releasedSaveAvailable.value = true;
      state.value = candidate;
      pending.value = undefined;
      error.value = "";
      pendingFinished = false;
    } catch {
      pendingFinished = finished;
      pending.value = candidate;
      error.value =
        "自動保存できませんでした。進行を停止しました。保存を再試行してください。";
      return false;
    }
    if (finished) {
      try {
        useResultsStore().capture(captureResult(candidate));
      } catch {
        useResultsStore().error =
          "終了結果を記録できませんでした。ゲーム保存と確定済み結果は保持されています。";
      }
    }
    return true;
  }

  function act(a: Action) {
    if (!state.value || pending.value) return;
    try {
      const candidate = dispatch(state.value, JSON.parse(JSON.stringify(a)));
      commit(candidate, !state.value.result && !!candidate.result);
    } catch (e) {
      error.value = (e as Error).message;
    }
  }

  function start(setup: Setup) {
    if (pending.value) return;
    try {
      commit(createGame(JSON.parse(JSON.stringify(setup)), V21_RULES_VERSION));
    } catch (e) {
      error.value = (e as Error).message;
    }
  }

  function save() {
    const candidate = pending.value ?? state.value;
    if (candidate && commit(candidate, !!pending.value && pendingFinished))
      notice.value = "保存しました";
  }

  function load(json?: string, rulesVersion?: string) {
    if (pending.value) return;
    try {
      let key = rulesVersion ? saveKey(rulesVersion) : undefined;
      let raw = json;
      if (json === undefined) {
        for (const slot of key
          ? [key]
          : [KEY, V204_KEY, NPC_KEY, PREVIOUS_KEY, PLAYTEST_KEY, RELEASE_KEY]) {
          const saved = localStorage.getItem(slot);
          if (saved !== null) {
            key = slot;
            raw = saved;
            break;
          }
        }
      }
      const legacyError =
        "ルール版が一致しません。旧セーブは元の保存枠に保持されています。";
      if (!raw)
        throw Error(
          LEGACY_KEYS.some((key) => localStorage.getItem(key))
            ? legacyError
            : "保存データがありません",
        );
      const loadedKey = saveKey(JSON.parse(raw)?.state?.rulesVersion);
      if (!loadedKey || (key && loadedKey !== key)) throw Error(legacyError);
      const loaded = deserialize(raw);
      if (json && !commit(loaded)) return;
      state.value = loaded;
      error.value = "";
      notice.value = "保存データを再開しました";
    } catch (e) {
      error.value = (e as Error).message;
    }
  }

  return {
    state,
    pending,
    error,
    notice,
    v204RulesSaveAvailable,
    npcRulesSaveAvailable,
    previousSaveAvailable,
    releasedSaveAvailable,
    playtestSaveAvailable,
    act,
    start,
    save,
    load,
  };
});
