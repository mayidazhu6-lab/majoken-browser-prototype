import { defineStore } from "pinia";
import { shallowRef, ref } from "vue";
import type { Action, GameState, Setup } from "../domain/types";
import { createGame, dispatch } from "../domain/reducer";
import { deserialize, serialize } from "../domain/persistence";
const KEY = "majoken-save-v2";
export const useGameStore = defineStore("game", () => {
  const state = shallowRef<GameState>();
  const error = ref("");
  const notice = ref("");
  function act(a: Action) {
    try {
      if (!state.value) return;
      state.value = dispatch(state.value, JSON.parse(JSON.stringify(a)));
      error.value = "";
      try {
        localStorage.setItem(KEY, serialize(state.value));
      } catch {
        notice.value = "自動保存できません。JSON保存をご利用ください。";
      }
    } catch (e) {
      error.value = (e as Error).message;
    }
  }
  function start(setup: Setup) {
    try {
      state.value = createGame(JSON.parse(JSON.stringify(setup)));
      error.value = "";
      localStorage.setItem(KEY, serialize(state.value));
    } catch (e) {
      error.value = (e as Error).message;
    }
  }
  function save() {
    if (state.value) {
      try {
        localStorage.setItem(KEY, serialize(state.value));
        notice.value = "保存しました";
      } catch {
        error.value = "保存できません。JSON保存をご利用ください。";
      }
    }
  }
  function load(json?: string) {
    try {
      const raw = json ?? localStorage.getItem(KEY);
      if (!raw)
        throw Error(
          localStorage.getItem("majoken-save-v1")
            ? "保存データのバージョンが一致しません。v0.1の保存データは保持されていますが、v0.2では再開できません。"
            : "保存データがありません",
        );
      state.value = deserialize(raw);
      error.value = "";
      notice.value = "保存データを再開しました";
      if (json) {
        try {
          localStorage.setItem(KEY, serialize(state.value));
        } catch {
          notice.value =
            "読込済み。自動保存できないためJSON保存をご利用ください。";
        }
      }
    } catch (e) {
      error.value = (e as Error).message;
    }
  }
  return { state, error, notice, act, start, save, load };
});
