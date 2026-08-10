import { describe, expect, it } from "vitest";

import { parseCslReferenceDocument } from "@/lib/articles/csl";
import {
  createReferenceBibTemplate,
  createReferenceJsonTemplate,
  initialContentForFileType,
} from "../templates";

describe("workspace reference templates", () => {
  it("covers every authorable pub.paper.reference field", () => {
    const document = JSON.parse(createReferenceJsonTemplate(2026));
    expect(document[0]).toEqual({
      id: "citation-key",
      type: "article-journal",
      title: "",
      containerTitle: "",
      issued: { year: 2026 },
      contributors: [
        { role: "author", family: "", given: "", sequence: 0 },
        { role: "author", literal: "", sequence: 1 },
      ],
      doi: "",
      arxivId: "",
      url: "",
    });
    expect(() => parseCslReferenceDocument(JSON.stringify(document))).toThrow("title is required");
  });

  it("creates a formatted BibTeX compatibility template", () => {
    const source = createReferenceBibTemplate(2026);
    expect(source).toContain("@article{citation-key,");
    expect(source).toContain("journal");
    expect(source).toContain("year");
    expect(source).toContain("doi");
    expect(source).toContain("eprint");
    expect(source).toContain("url");
  });

  it("only pre-populates bibliography data files", () => {
    expect(initialContentForFileType("markdown")).toBe("");
    expect(initialContentForFileType("tex")).toBe("");
    expect(initialContentForFileType("bib")).toContain("@article");
    expect(initialContentForFileType("json")).toContain('"contributors"');
  });
});
