
---

# 分散型学術査読・熟議アプリケーション 要件定義書:ScholarView

## 1. プロジェクト概要

AT Protocolのインフラを活用し、研究者のアイデア検討、実験計画の妥当性検証、および論文のオープンな査読（Peer Review）を行うDeSci（分散型サイエンス）アプリケーション。

論文本体の構造化データは「独自Lexicon」で管理し、査読コメントや熟議は巨大なユーザー基盤を持つ「Bluesky標準Lexicon」へ横流しするハイブリッド・アーキテクチャを採用する。

## 2. システムアーキテクチャ

- **データ保存先 (Write):** ユーザーが所属する公式PDS（bsky.social等）にタダ乗りしてデータを保存する。
    
- **データ集約 (Read):** アプリ側でFirehoseを購読（サブスクライブ）するAppViewサーバーを構築し、独自の論文データのみをローカルDB（SQLite/PostgreSQL等）にインデックスする。
    
- **バイナリデータ (PDF/画像):** PDSのBlob制限を回避するため、PDFファイル自体の保存はSuiエコシステムのWalrusやIPFSなどの分散ストレージ、あるいは外部オブジェクトストレージへオフロードし、PDSにはそのURIのみを記録する。
    

## 3. Lexicon設計（データモデリング）

論文や実験計画の柔軟なフォーマット（TeX/Markdown）をインポート可能にするため、Notionライクな「フラット配列＋階層レベル」のブロック構造を採用する。

### Lexicon ID: `sci.peer.article`

JSON

```
{
  "lexicon": 1,
  "id": "sci.peer.article",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["title", "blocks", "createdAt"],
        "properties": {
          "title": { "type": "string", "maxLength": 300, "description": "論文または実験計画のタイトル" },
          "blocks": {
            "type": "array",
            "description": "論文を構成する任意のセクション配列（フラット構造）",
            "items": {
              "type": "object",
              "required": ["level", "heading", "content"],
              "properties": {
                "level": { "type": "integer", "minimum": 1, "maximum": 6, "description": "階層の深さ。1:section, 2:subsection, 3:subsubsection..." },
                "heading": { "type": "string", "description": "セクションの見出し" },
                "content": { "type": "string", "description": "TeXまたはMarkdown形式の本文" }
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

**【保存されるデータのペイロード例】**

JSON

```
{
  "$type": "sci.peer.article",
  "title": "シラス多孔質ガラス薄膜の作製と応用における基礎的検討",
  "blocks": [
    {
      "level": 1,
      "heading": "実験手法",
      "content": "本研究では以下の手法を用いた。"
    },
    {
      "level": 2,
      "heading": "RFスパッタリングによる成膜",
      "content": "アルゴンガス雰囲気下で基板上に成膜を行い、熱力学的安定性を評価した..."
    }
  ],
  "createdAt": "2026-02-20T13:30:00Z"
}
```

## 4. Bluesky（標準プロトコル）との連携要件

本アプリの「熟議」の価値を最大化するため、独自のコメントシステムは構築せず、すべて `app.bsky.feed.post` へ依存させる。

### 4.1. 公開時のブロードキャスト（告知）

- **トリガー:** ユーザーが `sci.peer.article` をPDSに保存した直後。
    
- **アクション:** アプリのバックグラウンド処理により、ユーザーのアカウントから標準のBlueskyポストを自動投稿する。
    
- **内容:** 「新しい論文/実験計画を公開しました：『[タイトル]』 [本アプリのURL]」を含め、Blueskyのタイムライン上で査読者を募集する。
    

### 4.2. インラインコメント（特定のテキストへの熟議）

- **トリガー:** ユーザーがアプリ上で論文の特定テキスト（TeXコード等）をハイライトし、コメントを送信した時。
    
- **アクション:** 4.1で投稿された親ポストに対する「リプライ」として、`app.bsky.feed.post` をPDSに書き込む。
    
- **位置情報の保持:** どのテキストに対するコメントかを明示するため、Blueskyの外部リンクカード（`embed.external`）のURIパラメータに状態を埋め込む。
    
    - _URI例:_ `https://[AppDomain]/paper/[DID]/[RecordKey]?quote=アルゴンガス雰囲気下で基板上に`
        
- **UX:** Blueskyアプリ上からは通常のリプライ（リンクカード付き）として見え、本アプリ上からは該当のTeXコード部分が黄色くハイライトされたインラインコメントとして展開される。
    

## 5. フロントエンド機能要件（抜粋）

1. **TeX / Markdown パーサー:** インポートされたTeXファイルやtexプロジェクトのzip、PDF、markdownの `\section{}`,見出し、#1 等を解析し、`level` 属性付きのJSONブロック配列に自動変換するロジック。
    
2. **ブロックエディタ UI:** 変換されたブロック配列を画面にレンダリングし、ユーザーが直接加筆・修正（数式のリアルタイムプレビュー含む）できるインターフェース。
    
3. **ハイライト＆フック UI:** レンダリングされたテキストをドラッグ選択した際に、コメント入力用のポップアップを出し、対象文字列をパラメータ化してBskyのLexiconへ送る機能。
    

---
