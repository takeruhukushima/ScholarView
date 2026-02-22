"use client";

import { handleClientApiRequest } from "@/lib/client/api";

let installed = false;

export function installClientFetchBridge(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const intercepted = await handleClientApiRequest(input, init, originalFetch);
      if (intercepted) return intercepted;
    } catch {
      // Fall through to native fetch on bridge errors.
    }
    return originalFetch(input, init);
  };
}
