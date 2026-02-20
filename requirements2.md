ご提示いただいた要件定義書の内容と、これまでの「ローカルホスト（ローカルファースト）への転換」という方針を融合させた、最新の **`requirements.md`** を作成しました。

AT Protocolの分散性を活かしつつ、開発者もユーザーもクラウドの制約から解放される「自律型DeSciツール」としての要件にアップデートしています。

---

# 分散型学術査読・熟議アプリケーション 要件定義書: ScholarView (Local-First Edition)

## 1. プロジェクト概要

AT Protocolを活用し、研究者が自身のローカル環境から直接、論文公開・査読・熟議を行えるDeSci（分散型サイエンス）アプリケーション。

サーバーレスやPaaSの制約を排除するため、**「ユーザー自身がローカルでAppViewを起動する」**ローカルファーストな構成を採用する。データ保存は個人のPDSに行い、閲覧・検索のためのインデックスは手元のSQLiteで完結させる。

## 2. システムアーキテクチャ

* **実行環境:** 各ユーザーのローカルマシン（`localhost:3000`）。
* **データ保存先 (Write):** ユーザーが所属する公式PDS（bsky.social等）。
* **データ集約 (Read):** ローカルでFirehoseを購読するTapを常時起動し、自身の関心ある論文データをローカルSQLite（`app.db`）にインデックスする。
* **バイナリデータ:** PDF等の大型ファイルは、Sui/WalrusやIPFS等の分散ストレージ、あるいは任意のオブジェクトストレージへアップロードし、PDSにはそのURIを記録する。

## 3. Lexicon設計（データモデリング）

Notionライクな「フラット配列＋階層レベル」構造を採用し、TeX/Markdownの混在を許容する。

### Lexicon ID: `sci.peer.article`

```json
{
  "lexicon": 1,
  "id": "sci.peer.article",
  "defs": {
    "main": {
      "type": "record",
      "record": {
        "type": "object",
        "required": ["title", "blocks", "createdAt"],
        "properties": {
          "title": { "type": "string", "maxLength": 300 },
          "blocks": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["level", "heading", "content"],
              "properties": {
                "level": { "type": "integer", "minimum": 1, "maximum": 6 },
                "heading": { "type": "string" },
                "content": { "type": "string" }
              }
            }
          },
          "createdAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}

```

## 4. Bluesky（標準プロトコル）との連携

### 4.1. 告知（ブロードキャスト）のオプトイン

* **動作:** 論文（`sci.peer.article`）をPDSに保存する際、UI上で「Blueskyに告知を投稿する」のチェックボックスを表示する。
* **許可フロー:** ユーザーが明示的に許可した場合のみ、`app.bsky.feed.post` を投稿する。

### 4.2. ユニバーサル・ブラウザ・リンク

* **URL形式:** 告知ポストに含まれるリンクには、公式のコンテンツリゾルバーである **`https://atproto.at/`** を利用する。
* **リンク例:** `https://atproto.at/did:plc:xxx/sci.peer.article/yyy`
* **利点:** 特定のドメイン（scholarview.com等）に依存せず、AT Protocol上のどのクライアントからでも論文を参照可能にする。

### 4.3. インラインコメント（熟議）

* 特定のテキストを選択してコメントした際、告知ポストへのリプライとして投稿する。リプライ内の `embed.external` に、選択箇所の引用（quote）を含める。

## 5. フロントエンド機能

1. **Parser:** 各種ドキュメント（TeX, PDF, Markdown）を解析し、`blocks` 配列へ変換。
2. **Local Viewer:** ローカルSQLiteに蓄積された論文データを高速に検索・表示。
3. **Draft Storage:** 投稿前の下書き状態もローカルSQLiteに保持。

---

# Readme.md (Simplified)

## ScholarView: Local Setup

AT Protocolを用いた分散型論文投稿ツール。ローカル環境で動作します。

### 1. インストール

```bash
pnpm install

```

### 2. 型定義の生成

```bash
pnpm gen-lex

```

### 3. 環境設定

`.env.local` を作成（以下はデフォルト例）:

```bash
PUBLIC_URL=http://127.0.0.1:3000
DATABASE_PATH=app.db
TAP_URL=http://127.0.0.1:2480

```

### 4. 起動

```bash
pnpm dev

```

※ `localhost:3000` でUIが起動します。

### 5. データ同期 (Firehose Tap)

別のターミナルで同期プログラムを起動します:

```bash
tap run --collection-filters=sci.peer.article,app.bsky.feed.post

```

---

### 技術的な補足： `atproto.at` について

ご質問の「`atproto.at` のURLを貼れるか」ですが、**可能です！**
`atproto.at` はプロトコルレベルでの永続的なリンクを提供することを目的としたドメインで、`https://atproto.at/[DID]/[Collection]/[Rkey]` という形式でアクセスすると、そのレコードのデータを表示・解決してくれます。

これにより、「ScholarViewという特定のWebサービス」が消えても、リンク自体は有効であり続け、他のAT Protoアプリでその論文を読み込むことが可能になります。まさにDeSciにふさわしい設計ですね。

この定義書に基づいて、次は「`atproto.at` 形式のURLを生成してBlueskyに投稿する」ロジックの実装や、UIの調整をお手伝いしましょうか？
