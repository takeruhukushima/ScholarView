// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReferenceEditor } from "../ReferenceEditor";

describe("ReferenceEditor", () => {
  it("authors a reference with the form", () => {
    const onAdd = vi.fn();
    render(<ReferenceEditor onAdd={onAdd} />);
    fireEvent.click(screen.getByText("+ CSL reference"));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "A paper" } });
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2026" } });
    fireEvent.click(screen.getByText("Add to library"));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      type: "article-journal",
      title: "A paper",
      issued: { year: 2026 },
    }));
  });

  it("accepts direct CSL-JSON and reports invalid JSON", () => {
    const onAdd = vi.fn();
    render(<ReferenceEditor onAdd={onAdd} />);
    fireEvent.click(screen.getByText("+ CSL reference"));
    fireEvent.click(screen.getByText("JSON"));
    const editor = screen.getByRole("textbox");
    fireEvent.change(editor, { target: { value: "{" } });
    expect(screen.getByText(/Expected property name/)).toBeTruthy();
    fireEvent.change(editor, {
      target: { value: JSON.stringify({ type: "book", title: "Direct JSON" }) },
    });
    fireEvent.click(screen.getByText("Add to library"));
    expect(onAdd).toHaveBeenCalledWith({ type: "book", title: "Direct JSON" });
  });
});
