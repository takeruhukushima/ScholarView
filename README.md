# ScholarView

ScholarViewは、**研究執筆に特化したMarkdownエディタ**と、**AT Protocolでの公開・議論**をひとつにしたアプリです。

## コンセプト

「ただ書く」だけではなく、次の3つを一気通貫で扱います。

1. 研究メモ/草稿をローカルワークスペースで編集する  
2. BibTeX・数式・図表を研究向けの文法で扱う  
3. 論文として公開し、Bluesky上でインライン議論する

汎用ノートではなく、**研究者の執筆フローに寄せた設計**が前提です。

## 何ができるか

- フォルダ/ファイル型ワークスペース（ドラッグ&ドロップで並び替え・フォルダ移動）
- Markdown中心のブロック編集（見出し、数式、画像、引用）
- `@` から citation 候補を出し、本文では `[n]` 形式で参照表示
- プロジェクト配下の複数 `.bib` を自動認識して参考文献を生成
- 参考文献を本文下に自動表示（本文の `[n]` からジャンプ可能）
- `.md` / `.tex` エクスポート（参考文献付き）
- `sci.peer.article` への公開と、Bluesky告知投稿
- 公開後のDiscussion同期（Tap webhook経由）

## 想定ワークフロー

1. プロジェクト用フォルダを作る（例: `paper-a/`）
2. 草稿ファイル（`.md` / `.tex`）と `references.bib` を置く
3. 本文で `@citationKey` を使って引用を挿入する
4. 保存しながら執筆し、必要なら `.md` / `.tex` で出力する
5. PublishでAT Protocolに公開し、Blueskyで議論する

## セットアップ

### 1. 依存関係をインストール

```bash
pnpm install
```

### 2. 環境変数を設定

`.env.local` 例:

```bash
PUBLIC_URL=http://127.0.0.1:3000
TAP_URL=http://127.0.0.1:2480
TAP_ADMIN_PASSWORD=change-me
DATABASE_PATH=app.db
```

### 3. 開発サーバーを起動

`dev` 実行時にマイグレーションが自動実行されます。

```bash
pnpm dev
```

### 4. （必要時）Lexiconを再生成

`sci.peer.article` のLexiconは `lexicons/sci.peer.article.json` にあります。

```bash
lex build --importExt="" --indexFile --clear
```

## Tap起動（ローカル）

別ターミナルでTapを起動:

```bash
tap run \
  --webhook-url=http://127.0.0.1:3000/api/webhook \
  --collection-filters=sci.peer.article,app.bsky.feed.post
```

必要に応じて追跡DIDを追加:

```bash
curl -H 'Content-Type: application/json' \
  -d '{"dids":["did:plc:..."]}' \
  http://127.0.0.1:2480/repos/add
```

## 主要API

- `POST /api/workspace/files`
- `PATCH /api/workspace/files/[id]`
- `POST /api/workspace/files/[id]/publish`
- `GET /api/articles/[did]/[rkey]`
- `GET /api/articles/[did]/[rkey]/discussion`
- `POST /api/webhook`

## 補足

- OAuth scope: `atproto repo:sci.peer.article repo:app.bsky.feed.post`
- Webhook保護のため、`TAP_ADMIN_PASSWORD` はTap側と必ず一致させてください

## ブランチ運用メモ

- SPA静的化（`@atproto/oauth-client-browser` への移行を含む）実装は `spa-static-migration` ブランチで進行
- `main` には検証完了後に段階的に反映する方針
