// Cross-device reconciliation between a local workspace file and its published
// article on the PDS. Pure logic (no IO) so it can be unit-tested.
//
// The signals are CONTENT HASHES (not timestamps), which keeps the comparison
// clock-independent and avoids the authoring device clobbering its own richer
// source when the PDS reports a slightly different indexedAt:
//
// - `syncedContentHash` = hash of THIS device's local file content at the last
//   sync/publish point. `dirty = hash(localContent) !== syncedContentHash`
//   detects unpublished local edits. (Publishing keeps the rich editable source;
//   materializing writes the round-tripped published text, so this hash is
//   device-local and only ever compared to the same device's current content.)
// - `syncedRemoteHash` = hash of the published (round-tripped) content this file
//   was last reconciled against. `remoteChanged = hash(remoteContent) !== syncedRemoteHash`
//   detects that a new version was published (possibly from another device).

export type ReconcileAction =
  | "materialize" // no local copy yet -> create it from the PDS
  | "adopt-baseline" // legacy linked file without a baseline -> record baseline, keep local content
  | "auto-update" // local is clean and remote changed -> safe to pull PDS content
  | "conflict" // local has unpublished edits AND remote changed -> keep local, ask the user
  | "noop"; // nothing to do

// FNV-1a 32-bit hash, hex. Fast, non-cryptographic; only used for change detection.
export function hashContent(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export interface ReconcileResult {
  action: ReconcileAction;
  dirty: boolean;
  remoteChanged: boolean;
}

export function evaluateSync(params: {
  hasLocal: boolean;
  baselineLocalHash: string | null | undefined;
  baselineRemoteHash: string | null | undefined;
  localContent: string;
  remoteContent: string;
}): ReconcileResult {
  if (!params.hasLocal) {
    return { action: "materialize", dirty: false, remoteChanged: true };
  }

  const hasBaseline =
    params.baselineLocalHash != null && params.baselineRemoteHash != null;
  if (!hasBaseline) {
    // Legacy linked file predating baselines: don't guess a direction and never
    // auto-overwrite. Adopt the current local/remote state as the baseline quietly.
    return { action: "adopt-baseline", dirty: false, remoteChanged: false };
  }

  const dirty = hashContent(params.localContent) !== params.baselineLocalHash;
  const remoteChanged = hashContent(params.remoteContent) !== params.baselineRemoteHash;

  let action: ReconcileAction;
  if (!remoteChanged) {
    action = "noop";
  } else {
    action = dirty ? "conflict" : "auto-update";
  }

  return { action, dirty, remoteChanged };
}
