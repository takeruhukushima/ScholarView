import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ArticleViewer } from "../ArticleViewer";
import type { ArticleBlock } from "@/lib/articles/blocks";
import type { BibliographyEntry } from "@/lib/articles/citations";

// Mock useRouter
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// Mock Link from next/link
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("ArticleViewer", () => {
  const mockBlocks: ArticleBlock[] = [
    {
      heading: "Introduction",
      level: 2,
      content: "This is a citation [key1]. And another \\cite{key2}. Multi-cite: [key1, key2].",
    },
  ];

  const mockBibliography: BibliographyEntry[] = [
    {
      key: "key1",
      rawBibtex: "@article{key1, title={Title 1}, author={Author 1}, year={2020}}",
      title: "Title 1",
      author: "Author 1",
      year: "2020",
    },
    {
      key: "key2",
      rawBibtex: "@article{key2, title={Title 2}, author={Author 2}, year={2021}}",
      title: "Title 2",
      author: "Author 2",
      year: "2021",
    },
  ];

  it("renders citation numbers as links to bibliography", () => {
    render(
      <ArticleViewer
        did="did:plc:123"
        rkey="abc"
        title="Test Article"
        authors={[]}
        blocks={mockBlocks}
        bibliography={mockBibliography}
        comments={[]}
        canComment={false}
        canEdit={false}
        editHref="/edit"
        initialHighlightQuote={null}
      />
    );

    // Citation 1 should be rendered as a link to #cite-1
    const cite1Links = screen.getAllByText("1");
    // The first one is in the text, the second is in the bibliography
    // Wait, the bibliography item ALSO has text "1" in a span.
    // So there should be 3 occurrences of "1" total?
    // One in [1], one in [1, 2], and one in the bibliography [1].
    expect(cite1Links.length).toBeGreaterThanOrEqual(2);
    expect(cite1Links[0].closest("a")?.getAttribute("href")).toBe("#cite-1");
    expect(cite1Links[1].closest("a")?.getAttribute("href")).toBe("#cite-1");

    // Citation 2 should be rendered as a link to #cite-2
    const cite2Links = screen.getAllByText("2");
    expect(cite2Links.length).toBeGreaterThanOrEqual(2);
    expect(cite2Links[0].closest("a")?.getAttribute("href")).toBe("#cite-2");
    expect(cite2Links[1].closest("a")?.getAttribute("href")).toBe("#cite-2");

    // Bibliography items should have the corresponding IDs
    const bibItem1 = document.getElementById("cite-1");
    expect(bibItem1).toBeDefined();
    expect(bibItem1?.textContent).toContain("Author 1");

    const bibItem2 = document.getElementById("cite-2");
    expect(bibItem2).toBeDefined();
    expect(bibItem2?.textContent).toContain("Author 2");
  });
});
