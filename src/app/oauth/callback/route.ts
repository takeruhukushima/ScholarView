
import { NextRequest, NextResponse } from "next/server";
import { getOAuthClient } from "@/lib/auth/client";

const PUBLIC_URL = process.env.PUBLIC_URL || "http://127.0.0.1:3000";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const client = await getOAuthClient();

    // コードを交換してセッション取得
    const { session } = await client.callback(params);

    const response = NextResponse.redirect(new URL("/", PUBLIC_URL));

    // DIDクッキーを設定
    response.cookies.set("did", session.did, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 1 week
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("OAuth callback error:", error);
    return NextResponse.redirect(new URL("/?error=login_failed", PUBLIC_URL));
  }
}
