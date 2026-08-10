import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReferenceSyncNoticeModal } from "../ReferenceSyncNoticeModal";

describe("ReferenceSyncNoticeModal", () => {
  it("explains that reference files sync on the next Broadcast", () => {
    const onClose = vi.fn();
    render(<ReferenceSyncNoticeModal fileName="references.bib" onClose={onClose} />);
    expect(screen.getByText(/次回Broadcastまたは更新/)).toBeTruthy();
    expect(screen.getByText(/pub\.paper\.reference/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
