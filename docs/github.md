# GitHub接続・Pages公開準備

## v0.2.2作業（2026-10-30）

PR #1はopen/draft、head feat/browser-v0.2、base main、未マージを確認。同じブランチへv0.2.2を追加する。[原因・変更・懸念](v0.2.2.md)、[検証報告](test-report.md)。mainへのマージ・Pages公開は行わない。

## v0.2.1作業（履歴・2026-10-30）

対象8cea351の再レビュー4件の修正は [review-v0.2.1.md](review-v0.2.1.md)。同じブランチ・PR #1へ追加し、mainはマージしない。

既存の `feat/browser-v0.2` と [PR #1](https://github.com/mayidazhu6-lab/majoken-browser-prototype/pull/1) を更新。仕様確定・変更と制約は [v0.2.1.md](v0.2.1.md)。mainへのマージ・Pages公開は実施しない。

## v0.2作業（履歴・2026-10-30）

対象は `mayidazhu6-lab/majoken-browser-prototype`。作業ブランチは `feat/browser-v0.2`。ローカル検証結果は [test-report.md](test-report.md)。ユーザー指示に基づき作業ブランチをpushし、mainへのマージはレビュー承認後とする。Pagesは公開しない。

以下のv0.1作成時の未接続・未pushの説明は、当時の作業履歴として保持する。現在はoriginが対象リポジトリを指している。

## 2026-10-30 登録作業

- 作成済みリポジトリ：https://github.com/mayidazhu6-lab/majoken-browser-prototype
- GitHub APIでPrivateを確認済み。GitのHTTPS認証も確認済み。
- 既存の試遊版コミット `0d7d6ff497db1eea798a0e28c1445aaeef175cae` と注釈付き `v0.1` タグを保持する。
- 認証情報・ローカルセーブの除外設定を追加し、mainとv0.1をpushする。
- Vitest 96件と本番ビルドに成功。Pages公開は行わない。
- 以下はリポジトリ作成前の記録・参考手順。pushの成否と最終コミットIDは作業完了報告を参照。

2026-10-30（日本時間）確認。コネクターの認証ユーザーは `mayidazhu6-lab`。公開されたツール一覧にリポジトリ作成APIはなく、この端末に `gh` もありません。コネクターが認証済みであることは、ターミナルのGit認証が設定済みであることを意味しません。新規リポジトリ作成・push・Pages公開は実行していません。アカウントの契約プランもこの接続から確認できませんでした。

## Privateリポジトリの作成とpush

GitHubの「New repository」で以下を設定してください。

- Owner：利用するアカウント（確認済み接続は `mayidazhu6-lab`）
- Repository name：`majoken-browser-prototype`
- Visibility：**Private**
- README、.gitignore、Licenseの自動追加：オフ（ローカルに用意済み）

作成後、HTTPS認証またはSSHを設定したターミナルで以下を実行します。`OWNER` は作成先の実アカウント名に置き換えてください。

```sh
cd /Users/oosumimai/Documents/witches
git remote add origin https://github.com/OWNER/majoken-browser-prototype.git
git push -u origin main
```

GitHub CLIを別途導入済みなら、同じ作業フォルダから以下でも作成・pushできます。

```sh
gh auth login
gh repo create majoken-browser-prototype --private --source=. --remote=origin --push
```

これらは手順であり、この作業では未実行です。GitHub URLは作成成功後に確定します。Publicへの変更は行わず、変更が必要な場合は先にユーザーへ確認してください。

## CI

`.github/workflows/ci.yml` はpush・PR・手動実行でNode24 / npm ci / Vitest / build / 3seed試遊 / Playwrightを実行。テスト報告をActions artifactへ保存します。リモート未作成なのでGitHub上の実行結果は未確認です。

## Pagesの利用条件と公開範囲

GitHub公式では、FreeのPagesは公開リポジトリ、Pro・Team・EnterpriseはPrivateリポジトリからも利用可能です。[Creating a GitHub Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)

Privateリポジトリであることと、Pagesの閲覧者が限定されることは別です。Pagesの非公開アクセス制御には組織のGitHub Enterprise Cloud等の条件があります。個人Privateソースから通常のPagesへ出す場合も外部公開として扱い、事前承認が必要です。[Changing the visibility of your GitHub Pages site](https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site)

## 承認後のデプロイ

公開可否と契約プラン・Pages画面の公開範囲を実アカウントで確認してから、以下を行います。現在は未承認・未公開です。

1. ユーザーに具体的な完成版と公開範囲を示して外部公開の承認を得る。
2. Settings → Pages → SourceをGitHub Actionsにする。
3. Settings → Environments → `github-pages` に、利用プランで可能ならrequired reviewersを設定する。
4. Settings → Secrets and variables → Actions → Variablesに `PAGES_PUBLICATION_APPROVED=true` を設定する。
5. Actions → `Deploy Pages (approval required)` → Run workflowで `approved` をtrueにする。
6. build/testに成功後、Pages artifactをデプロイする。返されたURLで起動・公開範囲を確認する。

変数と手動入力の両方が満たされないとデプロイはスキップされます。push時のCIは公開しません。これはコード上のガードであり、GitHub管理者による設定変更を防ぐものではありません。

手順は [GitHubのカスタムPagesワークフロー](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)を参照しています。
