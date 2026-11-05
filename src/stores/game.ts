import { defineStore } from "pinia";
import { shallowRef, ref } from "vue";
import type { Action, GameState, Setup } from "../domain/types";
import { createGame, dispatch } from "../domain/reducer";
import { hasElementCombat, V20_RULES_VERSION } from "../domain/config";
import { deserialize, serialize } from "../domain/persistence";

const KEY = "majoken-save-rules-2.0-combat";
const LEGACY_KEYS = [
  "majoken-save-rules-2.0",
  "majoken-save-v2",
  "majoken-save-v1",
];

export const useGameStore = defineStore("game", () => {
  const state = shallowRef<GameState>();
  const pending = shallowRef<GameState>();
  const error = ref("");
  const notice = ref("");

  function commit(candidate: GameState) {
    try {
      localStorage.setItem(KEY, serialize(candidate));
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

  function load(json?: string) {
    if (pending.value) return;
    try {
      const raw = json ?? localStorage.getItem(KEY);
      const legacyError =
        "ルール版が一致しません。旧セーブは元の保存枠に保持されています。";
      if (!raw)
        throw Error(
          LEGACY_KEYS.some((key) => localStorage.getItem(key))
            ? legacyError
            : "保存データがありません",
        );
      if (!hasElementCombat(JSON.parse(raw)?.state ?? {}))
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

  return { state, pending, error, notice, act, start, save, load };
});
