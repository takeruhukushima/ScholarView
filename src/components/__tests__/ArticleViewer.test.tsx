import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ArticleViewer } from "../ArticleViewer";
import type { ArticleBlock } from "@/lib/articles/blocks";
import type { BibliographyEntry } from "@/lib/articles/citations";
import { referenceAnchorId } from "@/lib/workspace/utils";

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

    // Citation 1 should be rendered as a link to #cite-key1
    const cite1Links = screen.getAllByText("1");
    expect(cite1Links.length).toBeGreaterThanOrEqual(2);
    expect(cite1Links[0].closest("a")?.getAttribute("href")).toBe(`#${referenceAnchorId("cite", "key1")}`);
    expect(cite1Links[1].closest("a")?.getAttribute("href")).toBe(`#${referenceAnchorId("cite", "key1")}`);

    // Citation 2 should be rendered as a link to #cite-key2
    const cite2Links = screen.getAllByText("2");
    expect(cite2Links.length).toBeGreaterThanOrEqual(2);
    expect(cite2Links[0].closest("a")?.getAttribute("href")).toBe(`#${referenceAnchorId("cite", "key2")}`);
    expect(cite2Links[1].closest("a")?.getAttribute("href")).toBe(`#${referenceAnchorId("cite", "key2")}`);

    // Bibliography items should have the corresponding IDs
    const bibItem1 = document.getElementById(referenceAnchorId("cite", "key1"));
    expect(bibItem1).not.toBeNull();
    expect(bibItem1?.textContent).toContain("Author 1");

    const bibItem2 = document.getElementById(referenceAnchorId("cite", "key2"));
    expect(bibItem2).not.toBeNull();
    expect(bibItem2?.textContent).toContain("Author 2");
  });
});
