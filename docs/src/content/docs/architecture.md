---
title: Architecture
description: ScholarViewのクライアントサイド設計とAT Protocolの統合について
---

ScholarViewは、ユーザーのブラウザ上で完結する **Client-Side First** な設計を採用しており、AT Protocolを通じてデータの所有権をユーザーに還元します。

## 1. クライアントサイド・データ管理 (IndexedDB)

ScholarViewは、高速なオフライン操作とデータの永続化のために、ブラウザ標準の **IndexedDB** を活用しています。

- **Local Storage (`scholarview-client-db`)**: 論文の草稿（Drafts）、ワークスペースのファイル構造、および PDS から取得したレコードのキャッシュをローカルに保存します。
- **Direct PDS Interaction**: データの書き込み（Publishing）は、OAuth セッションを通じてユーザーの PDS に対して直接行われます。中央サーバーを介さないため、高い検閲耐性とプライバシーが確保されます。

## 2. 認証プロトコル (AT Protocol OAuth)

認証には **`@atproto/oauth-client-browser`** を使用しています。

- **Secure Login**: ユーザーは自身の Bluesky アカウントまたは DID を使用してログインします。
- **Scope-based Permission**: 論文レコード（`sci.peer.article`）や Bluesky ポスト（`app.bsky.feed.post`）の作成・削除に必要な最小限の権限のみを要求します。
- **AppView Resolution**: ブラウザが直接 PDS および AppView と通信し、リアルタイムなソーシャルデータを取得します。

## 3. 独自レキシコン: `sci.peer.article`

論文の構造化データは `sci.peer.article` というカスタムレキシコンで定義されます。

- **ブロック構造**: 論文は「フラット配列＋階層レベル（level）」を持つブロック（paragraph, heading, image等）として構成されます。
- **著者・引用・画像**: 著者リスト、BibTeX 形式の引用、および **PDS Blobs**（画像アセット）への参照を一括して管理します。

## 4. ハイブリッド連携 (Social & Academic)

ScholarViewは、学術的なデータの厳密さと、Bluesky のソーシャルな拡散力を融合させています。

- **Academic Layer**: 論文の本体と構造を独自レキシコンで管理。
- **Social Layer**: 査読コメント、熟議、いいね、リポストなどのアクションは、すべて標準の Bluesky ポスト（`app.bsky.feed.*`）を利用。

この設計により、論文を公開した瞬間から、Bluesky の広大なネットワーク上でピアレビュー（熟議）が開始される仕組みを実現しています。
