import { getOAuthClient } from "@/lib/auth/client";
import { NextResponse } from "next/server";

// このエンドポイントのURLがclient_idになる
// 認可サーバーはこの情報を取得してアプリ設定を把握する

export async function GET() {
  const client = await getOAuthClient();
  return NextResponse.json(client.clientMetadata);
}

