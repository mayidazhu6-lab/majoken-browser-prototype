# 旧新バランス比較（テスト限定）

正式リポジトリのルートから、導入済みのtsxを使用する。製品へのimportやpackage.jsonの変更は不要。

```sh
node --import tsx scripts/balance/compare.ts 100
node --import tsx scripts/balance/compare.ts 500
node --import tsx scripts/balance/report.ts docs/reports/balance-v204-500.json
```

compareの引数はゲーム数、任意のseed接頭辞、任意のJSON出力先。500回は先頭100回を含む。reportはJSONからMarkdownとプレイヤー単位CSVを生成する。

ai4.tsは既存createGameの0席だけをテスト状態内でAIに設定する。製品ルーム・セーブに流用しない。0席の初期値は結界・3/3/3固定なので、全席の初期配布が対称な実験ではない。自動選択はすべて既存reducerのAIを使用し、ハーネス独自の戦略は持たない。

想定外の意思決定待ち、進行上限、FP累計不一致、旧新初期条件不一致、4日目までのFP不一致、再実行不一致はエラーで停止する。ログのaiReasonは強制行動を含まず、duel選択は模擬戦も含む。通常公開決闘の実数には重複排除したcombatログを使う。

FP推移は日次HO後。崩壊日はその日の終了FPを欠損扱いとする。FP首位は同率全員、首席は卒業資格・日次HO同点判定を含む。主な逆転・首席・格差指標は完走ゲームを対象とし、崩壊率・イベント成否は全試行を対象に別集計する。

生データは要約ログであり、製品形式のセーブではない。全GameStateが必要ならrunAI4のstateを呼出側で扱う。再現性や報酬照合はtests/balance-ai4.test.ts、旧セーブ互換性は既存tests/late-public-duel.test.tsで検証する。
