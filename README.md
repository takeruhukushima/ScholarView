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
- 公開後のDiscussion同期（Bluesky thread + ローカル保存のマージ）

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
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000
```

`pnpm dev` / `pnpm build` 実行時に `public/client-metadata.json` が自動生成されます。
本番では `NEXT_PUBLIC_SITE_URL` を実際の公開URLに設定してください。

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

## アーキテクチャ（SPA）

- Vercel静的配信前提（`next.config.ts` は `output: "export"`）
- 認証: `@atproto/oauth-client-browser`
- ローカル永続化: IndexedDB
- `/api/*` はブラウザ内のfetchブリッジで処理（サーバーRoute Handlerなし）
- OAuth client metadataは `public/client-metadata.json` を静的配信

## ブランチ運用メモ

- 今回のSPA静的化（`@atproto/oauth-client-browser` への移行を含む）実装は `spa-static-migration` ブランチで実施
- `main` ブランチには段階的に反映する方針

## 補足

- OAuth scope: `atproto repo:sci.peer.article repo:app.bsky.feed.post`
- `handleResolver` は `https://bsky.social` を使用
- Webhook保護のため、`TAP_ADMIN_PASSWORD` はTap側と必ず一致させてください