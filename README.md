# ScholarView

AT Protocol上で論文・実験計画を公開し、Blueskyリプライを使ってインライン熟議できるNext.jsアプリです。

## 実装範囲

- OAuthログイン（AT Protocol）
- `sci.peer.article` レコード投稿
- 投稿時の `app.bsky.feed.post` 告知投稿
- テキスト選択からのインラインコメント投稿（Bluesky reply + `embed.external`）
- Tap webhook経由のリアルタイム同期
- 論文一覧、詳細、コメント表示

## セットアップ

### 1. 依存関係

```bash
pnpm install
```

### 2. Lexicon生成

`sci.peer.article` は `lexicons/sci.peer.article.json` にあります。

```bash
lex build --importExt="" --indexFile --clear
```

### 3. 環境変数

`.env.local` の例:

```bash
PUBLIC_URL=http://127.0.0.1:3000
TAP_URL=http://127.0.0.1:2480
TAP_ADMIN_PASSWORD=change-me
DATABASE_PATH=app.db
```

### 4. DBマイグレーション + 開発サーバー

```bash
pnpm dev
```

## Tap起動（ローカル）

別ターミナルでTapを起動します。

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

## 主要エンドポイント

- `POST /api/articles`
- `POST /api/articles/[did]/[rkey]/comments`
- `POST /api/webhook`
- `GET /paper/[did]/[rkey]`

## メモ

- OAuth scope: `atproto repo:sci.peer.article repo:app.bsky.feed.post`
- 論文本文入力は現状Markdownベースです。
