"use client";

// E2EE draft prototype — crypto core built on @fileverse/crypto (NaCl secretbox).
//
// Key model (envelope / wrapping):
//   VMK (Vault Master Key)  -- random 32 bytes, never encrypts content directly
//     ├─ device envelope    -- VMK wrapped by a non-extractable WebCrypto key (see deviceStore)
//     └─ recovery envelope  -- VMK wrapped by a random Recovery Key (stored on the PDS keyring)
//   Per-note DEK            -- random 32 bytes; note content = secretBox(DEK, json),
//                              DEK wrapped by VMK. Title lives INSIDE the ciphertext.
//
// This module holds the unlocked VMK in memory for the session and exposes pure
// crypto helpers. All persistence lives in deviceStore.ts (local) / encStore.ts (PDS).

import { generateSecretBoxKey, secretBoxEncrypt, secretBoxDecrypt } from "@fileverse/crypto/nacl";
import { bytesToBase64, toBytes } from "@fileverse/crypto/utils";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let sessionVmk: Uint8Array | null = null;

export function isUnlocked(): boolean {
  return sessionVmk !== null;
}

export function lock(): void {
  sessionVmk = null;
}

export function setVmk(vmk: Uint8Array): void {
  sessionVmk = vmk;
}

export function getVmk(): Uint8Array {
  if (!sessionVmk) throw new Error("Vault is locked");
  return sessionVmk;
}

export function generateVmk(): Uint8Array {
  return generateSecretBoxKey();
}

export function generateRecoveryKey(): Uint8Array {
  return generateSecretBoxKey();
}

// Recovery Key <-> user-facing string (url-safe base64).
export function recoveryKeyToString(key: Uint8Array): string {
  return bytesToBase64(key, true);
}

export function recoveryKeyFromString(value: string): Uint8Array {
  const key = toBytes(value.trim());
  if (key.length !== 32) throw new Error("Invalid recovery key");
  return key;
}

// Envelope = secretBox(wrappingKey, payloadBytes) -> base64 string.
export function wrap(wrappingKey: Uint8Array, payload: Uint8Array): string {
  return secretBoxEncrypt(wrappingKey, payload);
}

export function unwrap(wrappingKey: Uint8Array, envelope: string): Uint8Array {
  return secretBoxDecrypt(wrappingKey, envelope);
}

export interface EncryptedNote {
  ciphertext: string;
  wrappedDEK: string;
}

export interface NotePlaintext {
  title: string;
  body: string;
}

export function encryptNote(vmk: Uint8Array, note: NotePlaintext): EncryptedNote {
  const dek = generateSecretBoxKey();
  const ciphertext = secretBoxEncrypt(dek, encoder.encode(JSON.stringify(note)));
  const wrappedDEK = secretBoxEncrypt(vmk, dek);
  return { ciphertext, wrappedDEK };
}

export function decryptNote(vmk: Uint8Array, enc: EncryptedNote): NotePlaintext {
  const dek = secretBoxDecrypt(vmk, enc.wrappedDEK);
  const json = decoder.decode(secretBoxDecrypt(dek, enc.ciphertext));
  const parsed = JSON.parse(json) as NotePlaintext;
  return { title: parsed.title ?? "", body: parsed.body ?? "" };
}
