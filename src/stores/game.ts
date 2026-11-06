import { defineStore } from "pinia";
import { shallowRef, ref } from "vue";
import type { Action, GameState, Setup } from "../domain/types";
import { createGame, dispatch } from "../domain/reducer";
import { V20_RELEASE_RULES_VERSION, V20_RULES_VERSION } from "../domain/config";
import { deserialize, serialize } from "../domain/persistence";

const KEY = "majoken-save-rules-2.0.1";
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
  if (rulesVersion === V20_RULES_VERSION) return KEY;
  if (rulesVersion === V20_RELEASE_RULES_VERSION) return RELEASE_KEY;
}

function hasReleasedSave() {
  try {
    return localStorage.getItem(RELEASE_KEY) !== null;
  } catch {
    return false;
  }
}

export const useGameStore = defineStore("game", () => {
  const state = shallowRef<GameState>();
  const pending = shallowRef<GameState>();
  const error = ref("");
  const notice = ref("");
  const releasedSaveAvailable = ref(hasReleasedSave());

  function commit(candidate: GameState) {
    try {
      const key = saveKey(candidate.rulesVersion)!;
      localStorage.setItem(key, serialize(candidate));
      if (key === RELEASE_KEY) releasedSaveAvailable.value = true;
      state.value = candidate;
      pending.value = undefined;
      error.value = "";
      return true;
    } catch {
      pending.value = candidate;
      error.value =
        "自動保存できませんでした。進行を停止しました。保存を再試行してください。";
      return false;
    }
  }

  function act(a: Action) {
    if (!state.value || pending.value) return;
    try {
      commit(dispatch(state.value, JSON.parse(JSON.stringify(a))));
    } catch (e) {
      error.value = (e as Error).message;
    }
  }

  function start(setup: Setup) {
    if (pending.value) return;
    try {
      commit(createGame(JSON.parse(JSON.stringify(setup)), V20_RULES_VERSION));
    } catch (e) {
      error.value = (e as Error).message;
    }
  }

  function save() {
    const candidate = pending.value ?? state.value;
    if (candidate && commit(candidate)) notice.value = "保存しました";
  }

  function load(json?: string, released = false) {
    if (pending.value) return;
    try {
      const currentSave =
        json === undefined && !released ? localStorage.getItem(KEY) : null;
      const key = currentSave !== null ? KEY : RELEASE_KEY;
      const raw = json ?? currentSave ?? localStorage.getItem(RELEASE_KEY);
      const legacyError =
        "ルール版が一致しません。旧セーブは元の保存枠に保持されています。";
      if (!raw)
        throw Error(
          LEGACY_KEYS.some((key) => localStorage.getItem(key))
            ? legacyError
            : "保存データがありません",
        );
      const loadedKey = saveKey(JSON.parse(raw)?.state?.rulesVersion);
      if (!loadedKey || (json === undefined && loadedKey !== key))
        throw Error(legacyError);
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
    releasedSaveAvailable,
    act,
    start,
    save,
    load,
  };
});
