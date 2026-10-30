import type { Action, GameState, Setup } from "./types";
import { assertInvariants, createGame, dispatch } from "./reducer";
import { CONFIG } from "./config";
export function serialize(s: GameState) {
  return JSON.stringify(
    { format: "majoken-save", version: 2, state: s },
    null,
    2,
  );
}
export function replay(setup: Setup, actions: Action[]) {
  return actions.reduce(dispatch, createGame(setup));
}
export function deserialize(json: string): GameState {
  const data = JSON.parse(json);
  if (
    data?.format !== "majoken-save" ||
    data.version !== 2 ||
    data.state?.rulesVersion !== CONFIG.rulesVersion
  )
    throw Error(
      "保存データのバージョンが一致しません。v0.2の保存データを選択してください",
    );
  const s = data.state as GameState;
  assertInvariants(s);
  if (!Array.isArray(s.actions) || s.actions.length > 10000)
    throw Error("操作ログが不正です");
  const rebuilt = replay(s.setup, s.actions);
  if (JSON.stringify(s) !== JSON.stringify(rebuilt))
    throw Error("セーブの状態と操作ログが一致しません");
  return rebuilt;
}
