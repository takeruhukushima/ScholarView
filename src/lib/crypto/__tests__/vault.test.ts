// @vitest-environment node
// (pure crypto; node keeps TextEncoder output and tweetnacl in the same realm)
import { describe, it, expect } from "vitest";
import {
  decryptNote,
  encryptNote,
  generateRecoveryKey,
  generateVmk,
  recoveryKeyFromString,
  recoveryKeyToString,
  unwrap,
  wrap,
} from "../vault";

describe("vault crypto", () => {
  it("round-trips a note through DEK + VMK", () => {
    const vmk = generateVmk();
    const note = { title: "秘密のタイトル", body: "本文\nline2" };
    const enc = encryptNote(vmk, note);
    expect(enc.ciphertext).not.toContain("秘密");
    const dec = decryptNote(vmk, enc);
    expect(dec).toEqual(note);
  });

  it("fails to decrypt a note with the wrong VMK", () => {
    const vmk = generateVmk();
    const other = generateVmk();
    const enc = encryptNote(vmk, { title: "t", body: "b" });
    expect(() => decryptNote(other, enc)).toThrow();
  });

  it("wraps and unwraps the VMK with a recovery key", () => {
    const vmk = generateVmk();
    const recoveryKey = generateRecoveryKey();
    const envelope = wrap(recoveryKey, vmk);
    const restored = unwrap(recoveryKey, envelope);
    expect(Array.from(restored)).toEqual(Array.from(vmk));
  });

  it("round-trips the recovery key string form", () => {
    const key = generateRecoveryKey();
    const str = recoveryKeyToString(key);
    const back = recoveryKeyFromString(str);
    expect(Array.from(back)).toEqual(Array.from(key));
  });

  it("rejects an invalid recovery key string", () => {
    expect(() => recoveryKeyFromString("not-a-valid-key")).toThrow();
  });
});
