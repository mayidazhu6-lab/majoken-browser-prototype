import { readFileSync, writeFileSync } from "node:fs";
import type { extract } from "./ai4";
type Row = ReturnType<typeof extract>;
const input = process.argv[2] ?? "docs/reports/balance-v204-500.json";
const d = JSON.parse(readFileSync(input, "utf8"));
const a = d.summary.old,
  b = d.summary.current;
const old: Row[] = d.old,
  current: Row[] = d.current;
const pct = (x: number | null) =>
  x === null ? "未到達" : `${(x * 100).toFixed(2)}%`;
const num = (x: number | null) => (x === null ? "未到達" : x.toFixed(3));
const rate = (x: { n: number; d: number; rate: number | null }) =>
  `${pct(x.rate)}（${x.n}/${x.d}）`;
const table: string[] = ["| 指標 | 旧v2.0.3 | 新v2.0.4 |", "|---|---:|---:|"];
for (const [label, key] of [
  ["8日完走率", "completed"],
  ["研究所崩壊率", "collapse"],
  ["4日目首位の8日目首位維持率（人単位）", "leaderRetention"],
  ["4日目首位の誰かが8日目も首位（ゲーム単位）", "anyLeaderRetention"],
  ["FP逆転率（4日目非首位が最終首位に参加）", "reversal"],
  ["完全逆転率（元首位が全員首位から脱落）", "strictReversal"],
  ["4日目首位の最終首席率（完走・人単位）", "leaderChief"],
  ["同首席率（4日目到達全件・崩壊含む）", "leaderChiefAllReached4"],
  ["長期HO達成率（完走者）", "longGoal"],
  ["卒業者なし率（完走ゲーム）", "noChief"],
  ["協力イベント成功率（発生分）", "eventSuccess"],
  ["協力イベント失敗率（発生分）", "eventFailure"],
  ["4日目首位の後半公開決闘勝利シェア（完走）", "leaderLateWinShare"],
])
  table.push(`| ${label} | ${rate(a[key])} | ${rate(b[key])} |`);
for (const [label, key] of [
  ["最終平均FP（完走者）", "finalMeanFp"],
  ["最終FP最大−最小の平均", "finalRange"],
  ["最終FP1位−2位の平均", "finalTopGap"],
])
  table.push(`| ${label} | ${num(a[key])} | ${num(b[key])} |`);
for (const [label, key] of [
  ["公開決闘成立数（模擬戦除外）", "duels"],
  ["公開決闘勝利数（引分除外）", "wins"],
  ["5〜8日公開決闘成立数", "lateDuels"],
  ["5〜8日公開決闘勝利数", "lateWins"],
  ["仮納品操作ログ数", "reservations"],
  ["有効貢献ログ数", "contributions"],
])
  table.push(`| ${label} | ${a[key]} | ${b[key]} |`);

const completePairs = old.flatMap((r, i) =>
  r.reason === "completed" && current[i].reason === "completed"
    ? [{ a: r, b: current[i] }]
    : [],
);
const reversed = (r: Row) =>
  Number(r.finalLeaders.some((id) => !r.day4Leaders.includes(id)));
const diffs = completePairs.map((p) => reversed(p.b) - reversed(p.a));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const delta = mean(diffs);
const se = Math.sqrt(
  diffs.reduce((n, x) => n + (x - delta) ** 2, 0) /
    (diffs.length - 1) /
    diffs.length,
);
const up = diffs.filter((x) => x > 0).length,
  down = diffs.filter((x) => x < 0).length;
const changedFpLeaders = completePairs.filter(
  (p) => JSON.stringify(p.a.finalLeaders) !== JSON.stringify(p.b.finalLeaders),
).length;
const changedChiefs = completePairs.filter(
  (p) => JSON.stringify(p.a.chiefs) !== JSON.stringify(p.b.chiefs),
).length;
const changedHo = completePairs.reduce(
  (n, p) =>
    n +
    p.a.longGoals.filter((g, i) => g.achieved !== p.b.longGoals[i].achieved)
      .length,
  0,
);
const fpOnlyMatches = old.filter((r, i) =>
  r.final.every(
    (fp, id) =>
      current[i].final[id] ===
      fp + r.wins.filter((w) => w.day >= 5 && w.player === id).length,
  ),
).length;
const soloPairs = completePairs.filter((p) => p.a.day4Leaders.length === 1);
const marginChanges = soloPairs.map((p) => {
  const id = p.a.day4Leaders[0];
  const margin = (r: Row) =>
    r.final[id] - Math.max(...r.final.filter((_, j) => j !== id));
  return margin(p.b) - margin(p.a);
});
const rankRows = [
  "| 4日目首位の最終結果（完走・人単位） | 旧 | 新 |",
  "|---|---:|---:|",
  ...["1", "2", "3", "4", "notGraduated"].map(
    (k) =>
      `| ${k === "notGraduated" ? "未卒業" : `${k}位`} | ${a.leaderRanks[k] ?? 0} | ${b.leaderRanks[k] ?? 0} |`,
  ),
];
const dayRows = [
  "| 日 | 到達ゲーム旧/新 | 平均FP旧/新 | 最大−最小旧/新 | 1位−2位旧/新 |",
  "|---|---:|---:|---:|---:|",
  ...a.fpByDay.map((x: any, i: number) => {
    const y = b.fpByDay[i];
    return `| ${x.day} | ${x.n}/${y.n} | ${num(x.meanFp)}/${num(y.meanFp)} | ${num(x.range)}/${num(y.range)} | ${num(x.topGap)}/${num(y.topGap)} |`;
  }),
];
const choiceRows = [
  "| 公開AI選択ログ（強制行動を含まない） | 旧 | 新 |",
  "|---|---:|---:|",
  ...Object.keys(a.choices)
    .sort()
    .map((k) => `| ${k} | ${a.choices[k]} | ${b.choices[k] ?? 0} |`),
];
const report = `# 改修② バランス検証レポート（各${d.count}ゲーム）

2026年11月7日。基準コミット ${d.baseline}。正式フォルダのみを使用。

## 結論

旧新各${d.count}ゲームの同一シード比較。逆転率の差は ${(delta * 100).toFixed(2)}ポイント。後半報酬によって逆転機会は増える一方、最終FP格差も拡大する。首位を自動的に弱める仕組みではなく、後半に勝つ魔女を増幅する調整である。

今回のAIでは行動・勝敗・協力イベントの変化は観測されなかった。人間が報酬を意識して決闘や協力の選択を変える影響は未検証。推奨は「条件付きで採用を継続し、人間を含む試遊で確認」。逆転対策が完了したとは判断しない。

## 方法と開始確認

- 正式リポジトリ mayidazhu6-lab/majoken-browser-prototype。開始時main、未コミット変更なし、worktree1件。PR #13はGitHubでマージ済みを確認。GitHub APIで最新mainのSHAがローカルHEAD・origin/mainと一致することを確認（git経由の接続は名前解決に失敗したためAPIで代替）。
- 専用ブランチ feature/balance-v204-ai4。確認したチャット一覧に同じ検証を実行中の別チャットなし。製品コード・AI戦略・セーブ・ルーム条件は変更していない。バランス検証終了時点ではコミット・Push未実施。検証成果物は後続の保存作業で専用PRにまとめる。mainへのマージ・Pages公開は行わない。
- 正式仕様書「魔女たちの共同研究 仕様書 v2.0」を基準に、実装済み版を比較。旧browser-2.0.3は全日+1FP、新browser-2.0.4は1〜4日+1、5〜8日+2FP。同じ現行reducerの版別分岐を使用。
- seedは ${d.prefix}-0000 から ${d.prefix}-${String(d.count - 1).padStart(4, "0")}。各100組で問題がないことを確認後、同じ先頭100組を含む各500組へ拡大。100組と500組は独立標本ではない。
- createGame後、検証内だけで0席のaiをtrueにする。全員の行動は既存reducer内AIに任せ、ハーネスは確認・フェーズ進行のみ行う。初期状態・最初の4日間FPが全組一致すること、FPログ累計が最終FPと一致することを実行時に検査。先頭組を独立再実行し再現性を確認。
- 0席は結界・能力3/3/3固定。残り3席の魔法・能力・素材・HOは既存のシード付き初期化を使用。4席の意思決定AIは同じだが、初期配布の分布は完全対称ではない。
- 8日目終了FPは日次HO報酬後。4日目終了も日次HO判定後。未到達日はnullとし、崩壊時の途中FPを8日目FPとして代用しない。

## 旧新比較

${table.join("\n")}

同率FP首位は全員を数える。人単位の分母は、完走ゲーム内の4日目首位延べ人数。逆転率は、元首位が残っていても非首位が最終同率首位に加われば逆転とする。完全逆転率は元首位が全員外れた場合。首席は卒業資格・日次HO同点判定を反映したresult.chiefsを使う。全員の首席率は首席不在や同率があるため常に25%ではない。

${rankRows.join("\n")}

## FP推移

${dayRows.join("\n")}

日ごとにその日の日次HO判定まで到達したゲームを使用するため、日数間では対象が変わる。旧新の同一日については到達条件を確認して比較する。

## 行動・協力

${choiceRows.join("\n")}

duel選択には模擬戦候補も含むため、通常公開決闘の実数は上の成立数を使う。endTurn・取引・仮納品はAP行動ではない。選択ログ全件をAP消費行動の分母にしない。仮納品ログ数は資源量を表すものではなく、有効貢献ログ数・イベント成功率と併せて見る。

## ペア比較と所見

- 初期状態一致 ${d.summary.pairing.initialEqual}/${d.count}、4日目FP一致 ${d.summary.pairing.day4Equal}/${d.count}。
- 公開選択列一致 ${d.summary.pairing.publicChoicesEqual}/${d.count}、イベント成否列一致 ${d.summary.pairing.eventsEqual}/${d.count}、公開決闘勝利列一致 ${d.summary.pairing.winsEqual}/${d.count}、乱数消費回数一致 ${d.summary.pairing.drawsEqual}/${d.count}。
- 「旧で逆転なし→新で逆転あり」${up}組、反対${down}組。共通完走${completePairs.length}組の対応あり差 ${(delta * 100).toFixed(2)}ポイント。標本誤差の目安として対応あり正規近似95%区間 ${((delta - 1.96 * se) * 100).toFixed(2)}〜${((delta + 1.96 * se) * 100).toFixed(2)}ポイント。恣意的でない乱数シード選定ではあるが、全戦略・全初期条件の保証ではない。
- 最終FP首位集合が変化 ${changedFpLeaders}/${completePairs.length}組、首席集合が変化 ${changedChiefs}/${completePairs.length}組、長期HO達成の変化 ${changedHo}人。
- 全プレイヤーの新最終FP＝旧最終FP＋本人の後半公開勝利数が成立 ${fpOnlyMatches}/${d.count}組。今回の差は報酬加算で説明できる。長期HOは最終FP順位を参照する条件があるため、行動が同一でも達成者が変わり得る。
- 最終の1位−2位差と最大−最小差が拡大している。逆転率向上だけを成功条件にしない。4日目首位も後半に勝てば追加FPを得るため、個別ゲームでは独走を強め得る。
- 4日目単独首位だった共通完走${soloPairs.length}組では、その魔女の「最終FP−他3人の最大FP」が新ルールで増加${marginChanges.filter((x) => x > 0).length}組、減少${marginChanges.filter((x) => x < 0).length}組、同じ${marginChanges.filter((x) => x === 0).length}組。平均変化${num(mean(marginChanges))}FP。正の値への変化は元首位の優位拡大方向、負は縮小方向を表す（最終的な首位維持とは別指標）。
- 協力操作・有効貢献・イベント成功率が旧新で一致する範囲では、協力低下は観測されない。ただし「協力低下が起きない」という一般的な証明にはならない。

## 残るリスク・取得範囲

- 既存AIは主としてHO・イベント・行動コストで候補を評価する。新報酬を理解して方針を変える人間や、FP最適化AIの代替にはならない。同じシードでも将来の変更やFP依存判断によって行動・乱数消費が分岐する可能性がある。
- 長期HOは8日目に最終判定される。崩壊時のachieved=falseを「もし8日まで続けば未達」とは解釈しない。主表は完走者の達成率。崩壊を含む卒業率は別の成立性指標になる。
- 通算3失敗で即終了するため、各ゲーム必ず8日あるわけではない。イベント成功率は実際に判定したイベントが分母で、未発生の後半イベントを成功・失敗に補完しない。
- 指定された主要指標は取得できた。人間の楽しさ、納得感、報酬を理解した戦略変更、現実の4人ルーム成立性はこの検証では取得できない。
- 既存セーブ互換性：新規ゲームv2.0.4のみ新報酬。旧v2.0.3セーブは旧報酬のまま。今回のAI4席状態は製品セーブとして保存・読込せず、保存互換性は既存の旧版再生・保存枠分離テストで確認。
- 新規検証テスト2件を含む既存テスト472件成功、型チェック成功。製品変更がないためブラウザ試験・公開は実施していない。

## 再実行と成果物

実行は正式リポジトリを作業フォルダとして行う。

\`\`\`sh
node --import tsx scripts/balance/compare.ts 100
node --import tsx scripts/balance/compare.ts 500
node --import tsx scripts/balance/report.ts docs/reports/balance-v204-500.json
\`\`\`

compare.tsは回数・seed接頭辞・出力先を引数で指定可能。生データJSONには全組の各日FP、首位、首席、最終順位、HO、公開決闘、イベント、行動選択、ペア一致検査を保存。個別の戦闘全ラウンドや全夜行動ログは出力していないが、runAI4の戻り値GameStateから取得できる。
`;
writeFileSync(input.replace(/\.json$/, ".md"), report);
const csv = [
  "seed,version,reason,player,day4fp,finalfp,day4leader,finalleader,chief,rank,longHOAchieved,latePublicWins",
];
for (const r of [...old, ...current])
  for (let i = 0; i < 4; i++)
    csv.push(
      [
        r.seed,
        r.version,
        r.reason,
        i,
        r.fpDays[3]?.[i] ?? "",
        r.reason === "completed" ? r.final[i] : "",
        r.day4Leaders.includes(i),
        r.finalLeaders.includes(i),
        r.chiefs.includes(i),
        r.ranking.find((x) => x.player === i)?.rank ?? "",
        r.reason === "completed" ? r.longGoals[i].achieved : "",
        r.wins.filter((w) => w.day >= 5 && w.player === i).length,
      ].join(","),
    );
writeFileSync(input.replace(/\.json$/, ".csv"), csv.join("\n") + "\n");
console.log(input.replace(/\.json$/, ".md"));
