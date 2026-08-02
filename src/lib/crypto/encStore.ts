"use client";

// PDS persistence for the E2EE draft prototype, via raw XRPC (com.atproto.repo.*).
// Only ciphertext + wrapping envelopes ever leave the device.

import { getActiveDid, getSessionFetchHandler } from "@/lib/auth/browser";

const KEYRING_COLLECTION = "sci.peer.encVault";
const NOTE_COLLECTION = "sci.peer.encNote";
const KEYRING_RKEY = "self";

async function ctx() {
  const [did, fetchHandler] = await Promise.all([getActiveDid(), getSessionFetchHandler()]);
  if (!did || !fetchHandler) throw new Error("Not authenticated");
  return { did, fetchHandler };
}

async function xrpcGet(fetchHandler: (p: string, i?: RequestInit) => Promise<Response>, path: string) {
  const res = await fetchHandler(path);
  return res;
}

async function xrpcPost(
  fetchHandler: (p: string, i?: RequestInit) => Promise<Response>,
  path: string,
  body: unknown,
): Promise<Response> {
  return fetchHandler(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface KeyringValue {
  recoveryEnvelope: string;
  createdAt: string;
  updatedAt: string;
}

export async function getKeyring(): Promise<KeyringValue | null> {
  const { did, fetchHandler } = await ctx();
  const query = new URLSearchParams({
    repo: did,
    collection: KEYRING_COLLECTION,
    rkey: KEYRING_RKEY,
  });
  const res = await xrpcGet(fetchHandler, `/xrpc/com.atproto.repo.getRecord?${query.toString()}`);
  if (!res.ok) return null;
  const payload = (await res.json()) as { value?: Partial<KeyringValue> };
  const value = payload.value;
  if (!value || typeof value.recoveryEnvelope !== "string") return null;
  return {
    recoveryEnvelope: value.recoveryEnvelope,
    createdAt: value.createdAt ?? "",
    updatedAt: value.updatedAt ?? "",
  };
}

export async function putKeyring(recoveryEnvelope: string): Promise<void> {
  const { did, fetchHandler } = await ctx();
  const now = new Date().toISOString();
  const res = await xrpcPost(fetchHandler, "/xrpc/com.atproto.repo.putRecord", {
    repo: did,
    collection: KEYRING_COLLECTION,
    rkey: KEYRING_RKEY,
    record: {
      $type: KEYRING_COLLECTION,
      recoveryEnvelope,
      createdAt: now,
      updatedAt: now,
    },
  });
  if (!res.ok) throw new Error(`Failed to save keyring (${res.status})`);
}

export interface EncNoteRecord {
  rkey: string;
  ciphertext: string;
  wrappedDEK: string;
  updatedAt: string;
}

export async function listNotes(): Promise<EncNoteRecord[]> {
  const { did, fetchHandler } = await ctx();
  const query = new URLSearchParams({
    repo: did,
    collection: NOTE_COLLECTION,
    limit: "100",
  });
  const res = await xrpcGet(fetchHandler, `/xrpc/com.atproto.repo.listRecords?${query.toString()}`);
  if (!res.ok) return [];
  const payload = (await res.json()) as {
    records?: Array<{ uri?: string; value?: Record<string, unknown> }>;
  };
  const records = Array.isArray(payload.records) ? payload.records : [];
  const out: EncNoteRecord[] = [];
  for (const record of records) {
    const value = record.value ?? {};
    const rkey = typeof record.uri === "string" ? record.uri.split("/").pop() ?? "" : "";
    if (!rkey || typeof value.ciphertext !== "string" || typeof value.wrappedDEK !== "string") {
      continue;
    }
    out.push({
      rkey,
      ciphertext: value.ciphertext,
      wrappedDEK: value.wrappedDEK,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    });
  }
  return out;
}

export async function putNote(
  rkey: string,
  data: { ciphertext: string; wrappedDEK: string },
): Promise<void> {
  const { did, fetchHandler } = await ctx();
  const res = await xrpcPost(fetchHandler, "/xrpc/com.atproto.repo.putRecord", {
    repo: did,
    collection: NOTE_COLLECTION,
    rkey,
    record: {
      $type: NOTE_COLLECTION,
      ciphertext: data.ciphertext,
      wrappedDEK: data.wrappedDEK,
      updatedAt: new Date().toISOString(),
    },
  });
  if (!res.ok) throw new Error(`Failed to save note (${res.status})`);
}

export async function deleteNote(rkey: string): Promise<void> {
  const { did, fetchHandler } = await ctx();
  const res = await xrpcPost(fetchHandler, "/xrpc/com.atproto.repo.deleteRecord", {
    repo: did,
    collection: NOTE_COLLECTION,
    rkey,
  });
  if (!res.ok) throw new Error(`Failed to delete note (${res.status})`);
}

export function newNoteRkey(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}
