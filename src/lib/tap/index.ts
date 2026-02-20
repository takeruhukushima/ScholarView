import { Tap } from "@atproto/tap";

const TAP_URL = process.env.TAP_URL || "http://127.0.0.1:2480";

let _tap: Tap | null = null;

export function getTap(): Tap {
  if (!_tap) {
    _tap = new Tap(TAP_URL);
  }
  return _tap;
}
