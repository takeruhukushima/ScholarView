---
title: Getting Started
description: ScholarViewの開発環境セットアップと基本的なワークフロー
---

ScholarViewをローカルで起動し、分散型学術出版の世界へ踏み出すための手順を説明します。

## 必須環境 (Prerequisites)

セットアップを開始する前に、以下のツールがインストールされていることを確認してください。

- **Node.js**: v18.x 以上
- **pnpm**: パッケージマネージャー
- **lex CLI**: AT Protocol レキシコンの管理ツール (`npm install -g @atproto/lex`)

## セットアップ手順 (Installation)

1. **リポジトリのクローン**
   ```bash
   git clone https://github.com/takeruhukushima/ScholarView.git
   cd ScholarView
   ```

2. **依存関係のインストール**
   ```bash
   pnpm install
   ```

3. **レキシコンのビルド**
   独自のレキシコン定義から TypeScript の型定義を生成します。
   ```bash
   lex build --importExt=""
   ```

4. **アプリケーションの起動**
   ```bash
   pnpm dev
   ```

## 基本的な操作フロー

1. **ログイン**: サイドバーのログインボタンをクリックし、Bluesky のハンドル名を入力して OAuth 認証を完了させます。
2. **ワークスペース作成**: 左サイドバーのファイルツリーで `.md` や `.tex` ファイルを作成し、執筆を開始します。
3. **アセット追加**: 画像ファイルをエディタにドロップすると、自動的に PDS へアップロードされます。
4. **論文公開**: 執筆が完了したら、ツールバーから「公開」を選択し、Bluesky へブロードキャストします。
5. **熟議への参加**: 右パネルの Discussion タブで、他の研究者からのフィードバックを確認・返信します。

## 開発コミュニティ

不具合の報告や新機能の提案は、[GitHub Issues](https://github.com/takeruhukushima/ScholarView/issues) までお寄せください。ScholarView は 100% オープンソースであり、皆様の貢献を歓迎します。
