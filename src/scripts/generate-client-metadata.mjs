import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_PUBLIC_URL = "http://127.0.0.1:3000";

function normalizeBaseUrl(raw) {
  const url = new URL(raw);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function main() {
  const rawPublicUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.PUBLIC_URL ??
    DEFAULT_PUBLIC_URL;
  const baseUrl = normalizeBaseUrl(rawPublicUrl);

  const metadata = {
    client_id: `${baseUrl}/client-metadata.json`,
    client_name: "ScholarView",
    client_uri: baseUrl,
    logo_uri: `${baseUrl}/favicon.ico`,
    redirect_uris: [baseUrl],
    scope: "atproto repo:sci.peer.article repo:app.bsky.feed.post",
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
