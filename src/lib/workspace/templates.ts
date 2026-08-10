import { formatBibtexSource } from "@/lib/articles/citations";

/**
 * A necessary-and-sufficient authoring template for pub.paper.reference.
 * `$type` and `createdAt` are omitted because the record builder owns them.
 */
export function createReferenceJsonTemplate(year = new Date().getFullYear()): string {
  return `${JSON.stringify([
    {
      id: "citation-key",
      type: "article-journal",
      title: "",
      containerTitle: "",
      issued: { year },
      contributors: [
        {
          role: "author",
          family: "",
          given: "",
          sequence: 0,
        },
        {
          role: "author",
          literal: "",
          sequence: 1,
        },
      ],
      doi: "",
      arxivId: "",
      url: "",
    },
  ], null, 2)}\n`;
}

/** BibTeX compatibility template corresponding to the reference fields. */
export function createReferenceBibTemplate(year = new Date().getFullYear()): string {
  return `${formatBibtexSource(`@article{citation-key,
  author = {Family, Given},
  title = {Replace with title},
  journal = {Replace with container title},
  year = {${year}},
  doi = {},
  eprint = {},
  url = {}
}`)}\n`;
}

export function initialContentForFileType(
  fileType: "markdown" | "tex" | "bib" | "json",
): string {
  if (fileType === "json") return createReferenceJsonTemplate();
  if (fileType === "bib") return createReferenceBibTemplate();
  return "";
}
