import { defineStore } from "pinia";
import { ref, shallowRef } from "vue";
import {
  LAST_RESULT_KEY,
  decodeResult,
  encodeResult,
  type LastResult,
} from "../records/lastResult";
export const useResultsStore = defineStore("results", () => {
  const saved = shallowRef<LastResult>();
  const pending = shallowRef<string>();
  const error = ref("");
  const readError = ref("");
  function refresh() {
    try {
      const raw = localStorage.getItem(LAST_RESULT_KEY);
      saved.value = raw === null ? undefined : decodeResult(raw);
      readError.value = "";
    } catch {
      saved.value = undefined;
      readError.value =
        "前回の結果を読み込めません。記録は削除・変更していません。";
    }
  }
  function retry() {
    if (!pending.value) return;
    try {
      const record = decodeResult(pending.value);
      localStorage.setItem(LAST_RESULT_KEY, pending.value);
      saved.value = record;
      pending.value = undefined;
      error.value = "";
      readError.value = "";
    } catch {
      error.value =
        "終了結果を保存できませんでした。ゲーム結果は確定済みです。同じ結果の保存を再試行できます。";
    }
  }
  function capture(record: LastResult) {
    pending.value = encodeResult(record);
    retry();
  }
  refresh();
  return { saved, pending, error, readError, refresh, retry, capture };
});
