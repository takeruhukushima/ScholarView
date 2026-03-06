/**
 * AT Protocol Relay (BGS) に対して、指定したホストのクロールを要請します。
 * これにより、リレーが私たちのサーバー（PDS代行）にデータを吸い取りに来ます。
 */
export async function requestRelayCrawl(hostname: string = "scholar-view.vercel.app", repo?: string) {
  const RELAYS = [
    "https://bsky.network", // Bluesky公式リレー
  ];

  for (const relay of RELAYS) {
    try {
      console.log(`[ATProto] Requesting crawl from ${relay} for ${hostname}${repo ? ` (repo: ${repo})` : ""}`);
      const res = await fetch(`${relay}/xrpc/com.atproto.sync.requestCrawl`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ hostname }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.warn(`[ATProto] Relay ${relay} returned error:`, err);
      } else {
        console.log(`[ATProto] Successfully notified ${relay}`);
      }
    } catch (e) {
      console.error(`[ATProto] Failed to notify relay ${relay}:`, e);
    }
  }
}
