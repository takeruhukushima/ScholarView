import { describe, it, expect } from "vitest";
import { evaluateSync, hashContent } from "../reconcile";

describe("hashContent", () => {
  it("is deterministic and distinguishes different inputs", () => {
    expect(hashContent("hello")).toBe(hashContent("hello"));
    expect(hashContent("hello")).not.toBe(hashContent("hello!"));
    expect(hashContent("")).toBe(hashContent(""));
  });
});

describe("evaluateSync", () => {
  it("materializes when there is no local copy", () => {
    const result = evaluateSync({
      hasLocal: false,
      baselineLocalHash: null,
      baselineRemoteHash: null,
      localContent: "",
      remoteContent: "# Remote",
    });
    expect(result.action).toBe("materialize");
  });

  it("adopts a baseline for legacy linked files without one", () => {
    const result = evaluateSync({
      hasLocal: true,
      baselineLocalHash: null,
      baselineRemoteHash: null,
      localContent: "# Local rich source",
      remoteContent: "# Remote roundtrip",
    });
    expect(result.action).toBe("adopt-baseline");
  });

  it("does nothing when nothing changed", () => {
    const local = "# Local rich source";
    const remote = "# Remote roundtrip";
    const result = evaluateSync({
      hasLocal: true,
      baselineLocalHash: hashContent(local),
      baselineRemoteHash: hashContent(remote),
      localContent: local,
      remoteContent: remote,
    });
    expect(result.action).toBe("noop");
    expect(result.dirty).toBe(false);
    expect(result.remoteChanged).toBe(false);
  });

  it("auto-updates when local is clean and remote changed", () => {
    const local = "# published body";
    const oldRemote = "# published body";
    const newRemote = "# published body v2";
    const result = evaluateSync({
      hasLocal: true,
      baselineLocalHash: hashContent(local), // local unchanged since last sync -> clean
      baselineRemoteHash: hashContent(oldRemote),
      localContent: local,
      remoteContent: newRemote,
    });
    expect(result.action).toBe("auto-update");
    expect(result.dirty).toBe(false);
    expect(result.remoteChanged).toBe(true);
  });

  it("conflicts when local has unpublished edits and remote changed", () => {
    const baselineLocal = "# body";
    const baselineRemote = "# body";
    const result = evaluateSync({
      hasLocal: true,
      baselineLocalHash: hashContent(baselineLocal),
      baselineRemoteHash: hashContent(baselineRemote),
      localContent: "# body with local edits", // dirty
      remoteContent: "# body v2 from another device", // remote changed
    });
    expect(result.action).toBe("conflict");
    expect(result.dirty).toBe(true);
    expect(result.remoteChanged).toBe(true);
  });

  it("keeps local-only edits without conflict when remote is unchanged", () => {
    const remote = "# body";
    const result = evaluateSync({
      hasLocal: true,
      baselineLocalHash: hashContent("# body"),
      baselineRemoteHash: hashContent(remote),
      localContent: "# body with local edits", // dirty
      remoteContent: remote, // unchanged
    });
    expect(result.action).toBe("noop");
    expect(result.dirty).toBe(true);
    expect(result.remoteChanged).toBe(false);
  });
});
