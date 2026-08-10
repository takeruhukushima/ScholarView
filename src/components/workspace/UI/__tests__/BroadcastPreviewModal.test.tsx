// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BroadcastPreviewModal } from "../BroadcastPreviewModal";

describe("BroadcastPreviewModal", () => {
  it("can broadcast without posting an announcement to Bluesky", () => {
    const onConfirm = vi.fn();
    render(
      <BroadcastPreviewModal
        defaultText="Announcement"
        defaultPostToBluesky
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const checkbox = screen.getByRole("checkbox", {
      name: "Also post an announcement to Bluesky",
    });
    fireEvent.click(checkbox);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Confirm Broadcast" }));
    expect(onConfirm).toHaveBeenCalledWith("Announcement", false);
  });
});
