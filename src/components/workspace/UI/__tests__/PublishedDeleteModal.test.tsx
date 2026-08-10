import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PublishedDeleteModal } from "../PublishedDeleteModal";

describe("PublishedDeleteModal", () => {
  it("explains PDS deletion and requires an explicit destructive action", () => {
    const onConfirm = vi.fn();
    render(
      <PublishedDeleteModal
        name="paper.md"
        articleCount={1}
        busy={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("公開済みプロジェクトを完全に削除")).toBeTruthy();
    expect(screen.getByText(/sci\.peer\.article/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "完全に削除する" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
