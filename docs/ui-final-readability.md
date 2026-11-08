# UI最終調整：視認性・昼夜テーマ・研究所耐久

## 作業環境

正式作業フォルダ：`/Users/oosumimai/Documents/ChatGPT/魔女たちの共同研究/majoken-browser-prototype`

ブランチ：`feature/ui-final-readability`。PR #18統合済みの最新main（`4b7851c22817f8fc5fdf8a624e9e2450af9ed34a`）から作成。新規クローン・worktreeは作成していない。

## 5件の変更

1. 固有魔法：選択ボタンの補足文字が個別のmuted色を持ち、選択背景と近くなっていた。選択時はボタンの文字色を継承し、内枠と`aria-pressed`を追加。既存のキーボードフォーカス枠は維持。
2. 共通イベント結果：判定後には内部フェーズが既にmagic等へ移っているため、フェーズだけのテーマ判定で夜になっていた。既存の「解決済み・未確認」を優先して昼表示し、確認後はフェーズに従う。確認状態の省略は従来どおり未確認として扱う。
3. 研究所耐久：横長meterを共通GameIconの既存diamond SVG 3個へ変更。残数分を塗りつぶし、0/3〜3/3の数値・危険表示・崩壊条件の説明と詳細は維持。アイコン群はaria-hiddenで冗長な読み上げを防止。耐久計算は変更なし。
4. 夜明け：hoとdawnが昼のデフォルトへ落ちていたため、夜に対応付けた。翌日のpublicへ進むと昼になる。再開時も既存の状態から同じテーマを導く。
5. 研究・無効ボタン：共通disabledスタイルの透過をやめ、読みやすい文字色・背景・破線に統一。研究は既存actionErrorの結果をそのまま有効無効判定と理由表示に共有。AP・行動枠の説明がある場合はそちらを表示し、aria-describedbyで関連付けた。

ゲームルール・AI・乱数・AP/FP/HO・イベント処理・セーブ形式・保存キーは変更なし。共通SVG定義・5日目の案内・既存の導線や固定ヘッダーも変更していない。表示判定の試行dispatchは従来と同じクローン上の検証で、ゲーム状態を更新しない。

## 検証結果

- 単体テスト：504件成功（27ファイル）。全ゲーム再生1件はブラウザテストとの同時実行時に5秒を超えたが、同時実行を避けた再実行で全件成功。テスト制限やゲーム処理は変更していない。
- Playwright：全74件成功。既存テスト中の2箇所の旧meter検証を、ダイヤの数・塗りつぶし・数値の検証へ更新。
- 型チェック・本番ビルド：`npm run build`（vue-tsc / Vite）成功。
- 共通イベント成功・失敗とも確認前は昼、確認後は夜。結果表示中の再開を確認。表示前の保存ゲーム状態と、確認後のdispatch結果がそれぞれ一致。
- ho・dawnは夜、再開したdawnも夜、次の日の朝は昼。既存の5日目案内テストも成功。
- 研究の素材不足・AP枯渇時の表示、無効ボタンのclickが状態を変えないこと、有効研究のキーボード実行が既存dispatchと一致することを確認。
- 旧セーブ互換性、模擬戦の切替、固定ヘッダーとスマホの行動導線を含む既存回帰テストを実施。
- 1440 / 390 / 320px、100%倍率のPlaywright Chromiumで画面を確認。横スクロールなし。
- 選択魔法の文字7.24:1、共通無効ボタンの文字は昼5.08:1・夜5.51:1。選択・無効ラベルをブラウザの計算済み色でも4.5:1以上と確認。全UIのWCAG適合を保証する監査ではない。
- Chrome本体・スマホ実機・スクリーンリーダー実機は未実施。

## 改修前後キャプチャ

比較前はmain（4b7851c）上の表示を、変更前に同一の合法リプレイ状態で記録。比較用のFINAL_BEFORE指定では新仕様のアサーションを省き、撮影のみ行った。通常実行・CIでは全検証を行う。耐久4段階は、ゲーム状態を変更せず共通コンポーネントを独立表示して撮影。

### PC

| 画面 | 改修前 | 改修後 |
| --- | --- | --- |
| 固有魔法（選択・フォーカス） | [前](reports/ui-final-before/magic-1440.png) | [後](reports/ui-final-after/magic-1440.png) |
| 共通イベント成功 | [前](reports/ui-final-before/event-success-1440.png) | [後](reports/ui-final-after/event-success-1440.png) |
| 共通イベント失敗 | [前](reports/ui-final-before/event-failure-1440.png) | [後](reports/ui-final-after/event-failure-1440.png) |
| 耐久3/2/1/0 | [前](reports/ui-final-before/health-1440.png) | [後](reports/ui-final-after/health-1440.png) |
| 夜明けのまとめ | [前](reports/ui-final-before/dawn-1440.png) | [後](reports/ui-final-after/dawn-1440.png) |
| 研究（可能・素材不足） | [前](reports/ui-final-before/research-1440.png) | [後](reports/ui-final-after/research-1440.png) |

[AP枯渇時の研究表示](reports/ui-final-after/research-no-ap-1440.png)

### スマートフォン390px

| 画面 | 改修前 | 改修後 |
| --- | --- | --- |
| 固有魔法（選択・フォーカス） | [前](reports/ui-final-before/magic-390.png) | [後](reports/ui-final-after/magic-390.png) |
| 共通イベント成功 | [前](reports/ui-final-before/event-success-390.png) | [後](reports/ui-final-after/event-success-390.png) |
| 共通イベント失敗 | [前](reports/ui-final-before/event-failure-390.png) | [後](reports/ui-final-after/event-failure-390.png) |
| 耐久3/2/1/0 | [前](reports/ui-final-before/health-390.png) | [後](reports/ui-final-after/health-390.png) |
| 夜明けのまとめ | [前](reports/ui-final-before/dawn-390.png) | [後](reports/ui-final-after/dawn-390.png) |
| 研究（可能・素材不足） | [前](reports/ui-final-before/research-390.png) | [後](reports/ui-final-after/research-390.png) |

[AP枯渇時の研究表示](reports/ui-final-after/research-no-ap-390.png)

### スマートフォン320px

| 画面 | 改修前 | 改修後 |
| --- | --- | --- |
| 固有魔法（選択・フォーカス） | [前](reports/ui-final-before/magic-320.png) | [後](reports/ui-final-after/magic-320.png) |
| 共通イベント成功 | [前](reports/ui-final-before/event-success-320.png) | [後](reports/ui-final-after/event-success-320.png) |
| 共通イベント失敗 | [前](reports/ui-final-before/event-failure-320.png) | [後](reports/ui-final-after/event-failure-320.png) |
| 耐久3/2/1/0 | [前](reports/ui-final-before/health-320.png) | [後](reports/ui-final-after/health-320.png) |
| 夜明けのまとめ | [前](reports/ui-final-before/dawn-320.png) | [後](reports/ui-final-after/dawn-320.png) |
| 研究（可能・素材不足） | [前](reports/ui-final-before/research-320.png) | [後](reports/ui-final-after/research-320.png) |

[AP枯渇時の研究表示](reports/ui-final-after/research-no-ap-320.png)

## Gitと対象外

mainへのマージ、Pagesデプロイ、ブランチ・worktreeの削除は実施しない。PRでレビュー待ち。

保護対象ログ3件のSHA256は作業前後で一致。

- balance-v204-100.log: 2bf81565609210ab44d01ac643c8e6a0f8ae8e8a182f17b8f98590890bc29a88
- balance-v204-500.log: 355a8468090faf9a0680ae76e3f8b8a0662a9f029bb5fb668ccf60e1beda6263
- balance-validation.log: aabc31ab22556d52e3e2d44d8e7640db5b564676b747fa33d8f01ef253f2907b

仕様書更新、追加の試遊・オンライン対戦開発には着手していない。
