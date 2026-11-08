# UI追加調整：卒業課題・公開行動配置・研究・納品導線

## 作業環境

正式作業フォルダ：`/Users/oosumimai/Documents/ChatGPT/魔女たちの共同研究/majoken-browser-prototype`

ブランチ：`feature/ui-layout-research-delivery`。PR #19統合済みの最新main（`651ebcdf7071db320c6a01e2d80a0b53de04f48a`）から作成。開始時はmainとorigin/mainが一致し、コード変更なし、未追跡は保護対象ログ3件のみ。同じ改修ブランチ・別worktreeなし。新規クローン・worktreeは作成していない。

## 4件の変更

### 卒業課題

研究所耐久カードが課題カードの前に独立表示され、共通のfocus-screenの上マージンも加わっていた。課題カードを耐久カードより先に表示し、卒業課題だけ上マージンを12pxへ調整した。課題名はプラム色の明朝体・装飾線、条件文は読みやすい行間と文字サイズに変更。日次課題の文字サイズや5日目告知は拡大していない。固定の高さ・内容の切り捨て・固定位置ボタンは使わず、長文は通常のスクロールで確認できる。

### 公開行動の配置

全幅の独立した耐久カードが、PCの中央コンテンツを押し下げていた。公開行動の一覧では耐久を左サイド欄の先頭へ移動し、中央の手番説明・行動選択と上端を揃えた。耐久の見出し・数値・ダイヤを1行にまとめ、説明と詳細は次行に残した。スマホでは既存の縦順序を基本に耐久を先頭へ配置し、上部の「行動を選ぶ」から直接選択肢へ移動できる状態を維持。個別操作画面・戦闘・夜間結果にも耐久を残し、重複表示しない。

### 研究ボタン

既存の有効無効判定・実行処理は変更せず、有効時は既存primary配色＋魔導書アイコン＋「研究する（1AP）」、無効時は共通disabled配色＋鍵SVG＋「研究不可（1AP）」へ変更。鍵は既存共通SVGコンポーネント用の表示図形を1つ追加したもの。実行不可理由、必要素材／使用可能素材、disabled・aria-describedby・キーボードフォーカスは維持。

### 納品導線

公開行動一覧の表示対象からeventだけを除外。既存の納品用メタデータ・選択画面・ハンドラーは保持し、イベントカードの「納品へ（0AP）」から同じ画面へ移動する。行動回数型など納品を使わないイベントには、従来どおりイベントカードの納品入口はない。新しいルール・状態は追加していない。

ゲームルール、AI、乱数、AP/FP、研究・納品・戦闘・HO判定、耐久計算、セーブ形式・保存キー、昼夜テーマの判定関数、5日目の告知処理は変更していない。

## 検証

- 単体テスト：504件成功（27ファイル）。
- Playwright E2E：80件成功（追加6件）。
- 型チェック・本番ビルド：`npm run build`（vue-tsc / Vite）成功。
- PC1440px・スマホ390px・320pxで、卒業課題の位置、公開行動と耐久の配置、納品入口の一本化、研究ボタンの有効・無効表示を確認。
- 長文の卒業課題を高さ700px/568pxで独立表示し、横はみ出しなし・キーボードで確認ボタンを画面内へ移動して操作可能であることを確認。これはUIの長文負荷試験用テキストであり、実際の課題定義は変更していない。
- 卒業・日次課題の確認操作でゲーム保存文字列が変わらないことを確認。
- イベントカードからの予約が従来dispatch結果と一致し、AP消費なし。再保存・再開後も同じ入口から撤回操作へ到達できる。
- 有効研究の実行結果・素材不足/AP不足・無効操作防止・コントラスト・フォーカスは既存回帰テストを継続実施。耐久3/2/1/0、昼夜テーマ、旧セーブ、5日目案内、模擬戦切替、固定ヘッダーも成功。
- 既存テストは研究ボタンの新文言、イベントカードの入口に更新。ランダムイベントから納品へ移動していた薬表示テストは、納品対象の固定シードui3-1に変更。ゲーム開始まで開発者モードを維持してシードを適用し、開始後に解除する。実際のイベント名も検証し、当該ケースの3回連続成功を確認。公開進行テストは納品対象イベントだけ入口を操作し、行動回数型では入口がないことを確認する。
- 初回CIは薬表示テストの納品入口待ち1件がタイムアウト（79成功・1失敗）。固定シードをゲーム開始まで有効にするテスト設定順を修正し、同じPRへ追加。ゲーム本体の修正は不要だった。
- Playwright Chromium・100%倍率で確認。Chrome本体・スマホ実機・スクリーンリーダー実機は未実施。

## 比較キャプチャ

改修前はmain（651ebcd）のUI上で、同一の合法な初期状態を使って記録した。LAYOUT_BEFOREは撮影時だけ新仕様アサーションを省く比較用フラグ。通常実行・CIでは全検証を行う。卒業課題の再開表示には既存のpresentationを使い、新しい保存項目は追加していない。

### PC

| 画面 | 改修前 | 改修後 |
| --- | --- | --- |
| 卒業課題 | [前](reports/ui-layout-before/graduation-1440.png) | [後](reports/ui-layout-after/graduation-1440.png) |
| 公開行動・耐久・納品入口 | [前](reports/ui-layout-before/public-1440.png) | [後](reports/ui-layout-after/public-1440.png) |
| 研究実行ボタン | [前](reports/ui-layout-before/research-1440.png) | [後](reports/ui-layout-after/research-1440.png) |

[長文課題の表示試験](reports/ui-layout-after/long-graduation-1440.png)

### スマホ390px

| 画面 | 改修前 | 改修後 |
| --- | --- | --- |
| 卒業課題 | [前](reports/ui-layout-before/graduation-390.png) | [後](reports/ui-layout-after/graduation-390.png) |
| 公開行動・耐久・納品入口 | [前](reports/ui-layout-before/public-390.png) | [後](reports/ui-layout-after/public-390.png) |
| 研究実行ボタン | [前](reports/ui-layout-before/research-390.png) | [後](reports/ui-layout-after/research-390.png) |

[長文課題の表示試験](reports/ui-layout-after/long-graduation-390.png)

### スマホ320px

| 画面 | 改修前 | 改修後 |
| --- | --- | --- |
| 卒業課題 | [前](reports/ui-layout-before/graduation-320.png) | [後](reports/ui-layout-after/graduation-320.png) |
| 公開行動・耐久・納品入口 | [前](reports/ui-layout-before/public-320.png) | [後](reports/ui-layout-after/public-320.png) |
| 研究実行ボタン | [前](reports/ui-layout-before/research-320.png) | [後](reports/ui-layout-after/research-320.png) |

[長文課題の表示試験](reports/ui-layout-after/long-graduation-320.png)

## 状態

mainへのマージ、Pagesデプロイ、ブランチ・worktree削除は行わず、PRでレビュー待ちとする。保護対象の未追跡ログ3件は削除・上書き・退避せず、SHA256一致を確認する。

- balance-v204-100.log: 2bf81565609210ab44d01ac643c8e6a0f8ae8e8a182f17b8f98590890bc29a88
- balance-v204-500.log: 355a8468090faf9a0680ae76e3f8b8a0662a9f029bb5fb668ccf60e1beda6263
- balance-validation.log: aabc31ab22556d52e3e2d44d8e7640db5b564676b747fa33d8f01ef253f2907b

仕様書更新・追加試遊・オンライン対戦の作業には着手していない。
