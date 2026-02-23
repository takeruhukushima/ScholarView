import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_PUBLIC_URL = "http://127.0.0.1:3000";
const OAUTH_SCOPE =
  "atproto " +
  "repo:sci.peer.article?action=create&action=update&action=delete " +
  "repo:app.bsky.feed.post?action=create&action=delete " +
  "repo:app.bsky.feed.like?action=create " +
  "repo:app.bsky.feed.repost?action=create";

function isLoopbackHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function toUrlString(raw) {
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function normalizeBaseUrl(raw) {
  const url = new URL(toUrlString(raw));
  url.pathname = "";
  url.search = "";
  url.hash = "";
  if (!isLoopbackHost(url.hostname)) {
    url.protocol = "https:";
  }
  return url.toString().replace(/\/$/, "");
}

async function main() {
  const isVercel = process.env.VERCEL === "1";
  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_BRANCH_URL ||
    process.env.VERCEL_URL ||
    "";

  if (isVercel && !process.env.NEXT_PUBLIC_SITE_URL && !vercelHost) {
    throw new Error(
      "Vercel host is unavailable. Set NEXT_PUBLIC_SITE_URL to your deployment URL.",
    );
  }

  const rawPublicUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (isVercel ? vercelHost : "") ||
    process.env.PUBLIC_URL ||
    DEFAULT_PUBLIC_URL;
  const baseUrl = normalizeBaseUrl(rawPublicUrl);

  const metadata = {
    client_id: `${baseUrl}/client-metadata.json`,
    client_name: "ScholarView",
    client_uri: baseUrl,
    logo_uri: `${baseUrl}/favicon.ico`,
    redirect_uris: [baseUrl],
    scope: OAUTH_SCOPE,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "web",
    dpop_bound_access_tokens: true,
  };

  const outputDir = resolve(process.cwd(), "public");
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    resolve(outputDir, "client-metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
}

main().catch((error) => {
  console.error("Failed to generate OAuth client metadata:", error);
  process.exit(1);
});
