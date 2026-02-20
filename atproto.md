ソーシャルアプリの作成
ATレコードLexiconを使用してステータス更新をブロードキャストおよび受信できるアプリを構築
このチュートリアルでは、カスタムLexiconとリアルタイム同期を使ってステータス設定アプリを作成します。

このチュートリアルのソースコードは、statusphere-example-appリポジトリにあります。

前提条件
このチュートリアルは、OAuth with NextJSチュートリアルで作成したアプリをベースに進めます。開始前にNextJS OAuthアプリを完成させておいてください。この手順を省略したい場合は、Cookbookから完成版をクローンできます。

以下をインストールしておいてください。

Node.js 18以上
pnpmパッケージマネージャー
homebrewに対応したプラットフォームでは、次のコマンドでインストールできます。

brew install node pnpm go

Copy
Copied!
まず、用意したプロジェクトに以下のAtprotoライブラリを追加します。

pnpm add @atproto/common-web @atproto/lex @atproto/syntax @atproto/tap

Copy
Copied!
さらに、lex CLIツールをグローバルにインストールしておく必要があります。

npm install -g @atproto/lex

Copy
Copied!
まず、プロジェクトにLexiconを追加します。

パート1：Lexion
LexiconはAtprotoのレコードスキーマを定義します。このチュートリアル向けに、新しい"Statusphere" Lexicon（xyz.statusphere.status）をすでに公開しています。lexを使ってこのLexiconを取得し、プロジェクトに取り込みます。

lex install xyz.statusphere.status

Copy
Copied!
必要であれば、ダウンロードしたLexiconファイルをlib/lexicons/xyz.statusphere.status.jsonで確認できます。ここからlex buildを実行すると、インストール済みLexiconすべてに対してTypeScriptの型を生成できます。

lex build --importExt=\"\"

Copy
Copied!
必要に応じてこのコマンドをpackage.jsonに追加することもできますが、Lexiconがビルドできたので、このチュートリアルではもう使用しません。 lex installを使用して別のLexiconをプロジェクトに追加した場合は、--overrideフラグを指定してlex buildを再実行することで型を再生成する必要があります。

もう1つ、lib/auth/client.tsのSCOPE定数を更新してこのコレクションへのアクセスを要求してください。Atprotoの権限スコープはLexicon単位なので、アプリが要求するスコープにxyz.statusphere.statusを追加します。

export const SCOPE = "atproto repo:xyz.statusphere.status";

Copy
Copied!
これでデータベーススキーマの作成に進めます。

パート2：データベーススキーマ
lib/db/index.tsを更新して新しいテーブルを追加します。

export interface DatabaseSchema {
  auth_state: AuthStateTable;
  auth_session: AuthSessionTable;
  account: AccountTable;   // New
  status: StatusTable;     // New
}

// ... 既存の認可テーブル ...

export interface AccountTable {
  did: string;
  handle: string;
  active: 0 | 1;
}

export interface StatusTable {
  uri: string;
  authorDid: string;
  status: string;
  createdAt: string;
  indexedAt: string;
  current: 0 | 1;
}

Copy
Copied!
次に、これらのテーブルを作成する移行スクリプトを追加します。OAuthチュートリアルを土台にしていて、すでにデータベースをデプロイ/移行済みの場合は、lib/db/migrations.tsに新しいmigration（"002"など）として追加してください。

const migrations: Record<string, Migration> = {
  "001": {} // 認可テーブル用の既存migration
  "002": {
    async up(db: Kysely<unknown>) {
      await db.schema
        .createTable("account")
        .addColumn("did", "text", (col) => col.primaryKey())
        .addColumn("handle", "text", (col) => col.notNull())
        .addColumn("active", "integer", (col) => col.notNull().defaultTo(1))
        .execute();

      await db.schema
        .createTable("status")
        .addColumn("uri", "text", (col) => col.primaryKey())
        .addColumn("authorDid", "text", (col) => col.notNull())
        .addColumn("status", "text", (col) => col.notNull())
        .addColumn("createdAt", "text", (col) => col.notNull())
        .addColumn("indexedAt", "text", (col) => col.notNull())
        .addColumn("current", "integer", (col) => col.notNull().defaultTo(0))
        .execute();

      await db.schema
        .createIndex("status_current_idx")
        .on("status")
        .columns(["current", "indexedAt"])
        .execute();
    },
    async down(db: Kysely<unknown>) {
      await db.schema.dropTable("status").execute();
      await db.schema.dropTable("account").execute();
      await db.schema.dropTable("auth_session").execute();
      await db.schema.dropTable("auth_state").execute();
    },
  },
};

Copy
Copied!
pnpm migrateを実行して新しいmigrationをデータベースに適用できます。続いて、実際のアプリロジックを作っていきます。

パート3：ステータス投稿
まず、ユーザーが自分のPDSにステータスを書き込める機能を作成します。app/api/status/route.tsに新しいAPIルートを作成してください。

import { NextRequest, NextResponse } from "next/server";
import { Client } from "@atproto/lex";
import { getSession } from "@/lib/auth/session";
import { getOAuthClient } from "@/lib/auth/client";
import * as xyz from "@/src/lexicons/xyz";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { status } = await request.json();

  if (!status || typeof status !== "string") {
    return NextResponse.json({ error: "Status is required" }, { status: 400 });
  }

  const client = await getOAuthClient();
  const oauthSession = await client.restore(session.did);
  const lexClient = new Client(oauthSession);

  const createdAt = new Date().toISOString();
  const res = await lexClient.create(xyz.statusphere.status, {
    status,
    createdAt,
  });

  return NextResponse.json({
    success: true,
    uri: res.uri,
  });
}

Copy
Copied!
この処理では、ユーザーのログイン状態を確認し、OAuthセッションからlexのClientを作成し、送信されたステータステキストでxyz.statusphere.statusレコードを新規作成します。

次に、components/StatusPicker.tsxにステータス選択コンポーネントを作成します。

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const EMOJIS = ["👍", "👎", "💙", "🔥", "😆", "😢", "🤔", "😴", "🎉", "🤩", "😭", "🥳", "😤", "💀", "✨", "👀", "🙏", "📚", "💻", "🍕", "🌴"];

interface StatusPickerProps {
  currentStatus?: string | null;
}

export function StatusPicker({ currentStatus }: StatusPickerProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(currentStatus ?? null);
  const [loading, setLoading] = useState(false);

  async function handleSelect(emoji: string) {
    setLoading(true);
    setSelected(emoji);

    try {
      const res = await fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: emoji }),
      });

      if (!res.ok) {
        throw new Error("Failed to update status");
      }

      router.refresh();
    } catch (err) {
      console.error("Failed to update status:", err);
      setSelected(currentStatus ?? null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">
        Set your status
      </p>
      <div className="flex flex-wrap gap-2">
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => handleSelect(emoji)}
            disabled={loading}
            className={`text-2xl p-2 rounded-lg transition-all
              ${selected === emoji
                ? "bg-blue-100 dark:bg-blue-900 ring-2 ring-blue-500"
                : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }
              disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

Copy
Copied!
最後に、app/page.tsxを更新してステータス選択を組み込みます。

import { getSession } from "@/lib/auth/session";
import { LoginForm } from "@/components/LoginForm";
import { LogoutButton } from "@/components/LogoutButton";
import { StatusPicker } from "@/components/StatusPicker";

export default async function Home() {
  const session = await getSession();

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <main className="w-full max-w-md mx-auto p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">
            Statusphere
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Set your status on the Atmosphere
          </p>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
          {session ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Signed in
                </p>
                <LogoutButton />
              </div>
              <StatusPicker />
            </div>
          ) : (
            <LoginForm />
          )}
        </div>
      </main>
    </div>
  );
}

Copy
Copied!
pnpm devでアプリを起動すると、ログインして絵文字を選び、ステータスを設定できます。


この時点ではアプリ内で自分のステータスを表示できませんが、atproto.atでアカウントを確認し、xyz.statusphere.status Lexiconを見るとレコードを確認できます。


次に、実際にステータス更新を受け取るための同期機能を追加します。

パート4：Tapによるリアルタイム同期
TapはATプロトコルレコードを同期・ストリームする最適な方法です。TapのTypeScriptライブラリを使って、データベースへ新規レコードを同期します。lib/tap/index.tsを作成してください:

import { Tap } from "@atproto/tap";

const TAP_URL = process.env.TAP_URL || "http://localhost:2480";

let _tap: Tap | null = null;

export const getTap = (): Tap => {
  if (!_tap) {
    _tap = new Tap(TAP_URL);
  }
  return _tap;
};

Copy
Copied!
次に、Tapイベント処理用のデータベースクエリをlib/db/queries.tsに作成します。

import { getDb, AccountTable, StatusTable, DatabaseSchema } from ".";
import { AtUri } from "@atproto/syntax";
import { Transaction } from "kysely";

export async function getAccountStatus(did: string) {
  const db = getDb();
  const status = await db
    .selectFrom("status")
    .selectAll()
    .where("authorDid", "=", did)
    .orderBy("createdAt", "desc")
    .limit(1)
    .executeTakeFirst();
  return status ?? null;
}

export async function insertStatus(data: StatusTable) {
  getDb()
    .transaction()
    .execute(async (tx) => {
      await tx
        .insertInto("status")
        .values(data)
        .onConflict((oc) =>
          oc.column("uri").doUpdateSet({
            status: data.status,
            createdAt: data.createdAt,
            indexedAt: data.indexedAt,
          }),
        )
        .execute();
      setCurrStatus(tx, data.authorDid);
    });
}

export async function deleteStatus(uri: AtUri) {
  await getDb()
    .transaction()
    .execute(async (tx) => {
      await tx.deleteFrom("status").where("uri", "=", uri.toString()).execute();
      await setCurrStatus(tx, uri.hostname);
    });
}

export async function upsertAccount(data: AccountTable) {
  await getDb()
    .insertInto("account")
    .values(data)
    .onConflict((oc) =>
      oc.column("did").doUpdateSet({
        handle: data.handle,
        active: data.active,
      }),
    )
    .execute();
}

export async function deleteAccount(did: string) {
  await getDb().deleteFrom("account").where("did", "=", did).execute();
  await getDb().deleteFrom("status").where("authorDid", "=", did).execute();
}

// ユーザーのステータスを最新に更新するヘルパー（トランザクション内)
async function setCurrStatus(tx: Transaction<DatabaseSchema>, did: string) {
  // 全ユーザーのステータスの最新フラグをクリア
  await tx
    .updateTable("status")
    .set({ current: 0 })
    .where("authorDid", "=", did)
    .where("current", "=", 1)
    .execute();
  // 直近のステータスを最新に設定
  await tx
    .updateTable("status")
    .set({ current: 1 })
    .where("uri", "=", (qb) =>
      qb
        .selectFrom("status")
        .select("uri")
        .where("authorDid", "=", did)
        .orderBy("createdAt", "desc")
        .limit(1),
    )
    .execute();
}

Copy
Copied!
setCurrStatusヘルパーは、各ユーザーで最新ステータスだけがcurrent = 1になるよう保証します。この後の処理で利用します。

Tapはapp/api/webhook/route.tsのwebhookエンドポイント経由でイベントを配信します。

import { NextRequest, NextResponse } from "next/server";
import { parseTapEvent, assureAdminAuth } from "@atproto/tap";
import { AtUri } from "@atproto/syntax";
import {
  upsertAccount,
  insertStatus,
  deleteStatus,
  deleteAccount,
} from "@/lib/db/queries";
import * as xyz from "@/src/lexicons/xyz";

const TAP_ADMIN_PASSWORD = process.env.TAP_ADMIN_PASSWORD;

export async function POST(request: NextRequest) {
  // 自分のTAPサーバーからのリクエストであることを検証
  if (TAP_ADMIN_PASSWORD) {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
      assureAdminAuth(TAP_ADMIN_PASSWORD, authHeader);
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await request.json();
  const evt = parseTapEvent(body);

  // アカウント/IDの変更を処理
  if (evt.type === "identity") {
    if (evt.status === "deleted") {
      await deleteAccount(evt.did);
    } else {
      await upsertAccount({
        did: evt.did,
        handle: evt.handle,
        active: evt.isActive ? 1 : 0,
      });
    }
  }

  // ステータスレコードの変更を処理
  if (evt.type === "record") {
    const uri = AtUri.make(evt.did, evt.collection, evt.rkey);

    if (evt.action === "create" || evt.action === "update") {
      let record: xyz.statusphere.status.Main;
      try {
        record = xyz.statusphere.status.$parse(evt.record);
      } catch {
        return NextResponse.json({ success: false });
      }

      await insertStatus({
        uri: uri.toString(),
        authorDid: evt.did,
        status: record.status,
        createdAt: record.createdAt,
        indexedAt: new Date().toISOString(),
        current: 1,
      });
    } else if (evt.action === "delete") {
      await deleteStatus(uri);
    }
  }

  return NextResponse.json({ success: true });
}

Copy
Copied!
Tapはネットワーク上のどこかでレコードが変更されるとwebhookイベントを送信します。リクエストは共有シークレットで検証され、identityイベントではアカウントキャッシュを更新し、recordイベントではレコードがLexiconに一致するかを確認してデータベースへinsert/update/deleteします。

app/page.tsxを再度更新し、現在ユーザーのステータスを取得して渡すようにします。

import { getAccountStatus } from "@/lib/db/queries";

// ホーム機能で使用
const accountStatus = session ? await getAccountStatus(session.did) : null;

// ステータス選択要素
<StatusPicker currentStatus={accountStatus?.status} />

Copy
Copied!
これにより、ページ読み込み時にStatusPickerがユーザーの現在ステータスをハイライトします。

次に別ターミナルで、ソースリポジトリからtapをインストールして実行します。

go install github.com/bluesky-social/indigo/cmd/tap
tap run --webhook-url=http://localhost:3000/api/webhook --collection-filters=xyz.statusphere.status

Copy
Copied!
実行中のアプリをCtrl+Cで停止し、追跡対象として自分のデータリポジトリをTapに追加します（他のデータソースは後で追加します）。

# あなたのDIDに置き換えてください
curl -H 'Content-Type: application/json' -d '{"dids":["DID"]}' http://localhost:2480/repos/add

Copy
Copied!
pnpm devでアプリを再起動してログインフローを完了すると、保存済みステータスがハイライト表示されます。


パート5：ハンドルとフィードの表示
最後に、ユーザーハンドル表示と、全ユーザーのステータスフィード表示機能を追加します。

まず、lib/db/queries.tsに追加のimportを入れます。

import { getHandle } from "@atproto/common-web";
import { getTap } from "@/lib/tap";

Copy
Copied!
続いて、アカウントハンドルとステータスを取得する関数を追加します。

export async function getAccountHandle(did: string): Promise<string | null> {
  const db = getDb();
  // 追跡対象アカウントでアカウント情報を取得済みの場合、それを読み込みます
  const account = await db
    .selectFrom("account")
    .select("handle")
    .where("did", "=", did)
    .executeTakeFirst();
  if (account) return account.handle;
  // それ以外の場合は、IDキャッシュを提供するTapを通じてDIDを解決します
  try {
    const didDoc = await getTap().resolveDid(did);
    if (!didDoc) return null;
    return getHandle(didDoc) ?? null;
  } catch {
    return null;
  }
}

export async function getRecentStatuses(limit = 5) {
  const db = getDb();
  return db
    .selectFrom("status")
    .innerJoin("account", "status.authorDid", "account.did")
    .selectAll()
    .orderBy("createdAt", "desc")
    .limit(limit)
    .execute();
}

export async function getTopStatuses(limit = 10) {
  const db = getDb();
  return db
    .selectFrom("status")
    .select(["status", db.fn.count("uri").as("count")])
    .where("current", "=", 1)
    .groupBy("status")
    .orderBy("count", "desc")
    .limit(limit)
    .execute();
}

Copy
Copied!
次に app/page.tsxを更新し、上位ステータス、ハンドル、タイムスタンプを含む完全なフィードを表示します。

import { getSession } from "@/lib/auth/session";
import {
  getAccountStatus,
  getRecentStatuses,
  getTopStatuses,
  getAccountHandle,
} from "@/lib/db/queries";
import { LoginForm } from "@/components/LoginForm";
import { LogoutButton } from "@/components/LogoutButton";
import { StatusPicker } from "@/components/StatusPicker";

export default async function Home() {
  const session = await getSession();
  const [statuses, topStatuses, accountStatus, accountHandle] =
    await Promise.all([
      getRecentStatuses(),
      getTopStatuses(),
      session ? getAccountStatus(session.did) : null,
      session ? getAccountHandle(session.did) : null,
    ]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <main className="w-full max-w-md mx-auto p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">
            Statusphere
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Set your status on the Atmosphere
          </p>
        </div>

        {session ? (
          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Signed in as @{accountHandle ?? session.did}
              </p>
              <LogoutButton />
            </div>
            <StatusPicker currentStatus={accountStatus?.status} />
          </div>
        ) : (
          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 mb-6">
            <LoginForm />
          </div>
        )}

        {topStatuses.length > 0 && (
          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 mb-6">
            <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">
              Top Statuses
            </h3>
            <div className="flex flex-wrap gap-2">
              {topStatuses.map((s) => (
                <span
                  key={s.status}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-sm"
                >
                  <span className="text-lg">{s.status}</span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {String(s.count)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
          <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">
            Recent
          </h3>
          {statuses.length === 0 ? (
            <p className="text-zinc-500 dark:text-zinc-400 text-sm">
              No statuses yet. Be the first!
            </p>
          ) : (
            <ul className="space-y-3">
              {statuses.map((s) => (
                <li key={s.uri} className="flex items-center gap-3">
                  <span className="text-2xl">{s.status}</span>
                  <span className="text-zinc-600 dark:text-zinc-400 text-sm">
                    @{s.handle}
                  </span>
                  <span className="text-zinc-400 dark:text-zinc-500 text-xs ml-auto">
                    {timeAgo(s.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}

function timeAgo(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

Copy
Copied!
これでログイン中ユーザーには単なる"Signed in"ではなく"Signed in as @theirhandle"が表示され、全ユーザーの最新ステータスフィードと、人気の現在ステータスを示す"Top Statuses"セクションも表示されます。

pnpm devでアプリを停止・再起動できます。

最後に、先ほどtapには単一データソースしか追加していません。ネットワーク全体のステータスを見るには、--signal-collectionフラグ付きでtapを停止して再実行します。

tap run \
  --webhook-url=http://localhost:3000/api/webhook \
  --collection-filters=xyz.statusphere.status \
  --signal-collection=xyz.statusphere.status

Copy
Copied!
すると、ネットワーク上の他ユーザーのステータスも見えるようになります。


結論
これで、OAuthログイン、カスタムLexiconによるステータスレコード定義、Tapによるリアルタイム同期を備えた完全なAtprotoアプリが完成しました。

さらに多くのガイドやチュートリアルはGuidesセクションで、より多くのサンプルアプリはCookbookリポジトリで確認できます。ぜひ開発を楽しんでください。
