import { describe, it, expect } from "vitest";
import {
  cslTypeToBibtexType,
  formatContributorsBibtex,
  deriveCitationKey,
  deriveUniqueCitationKeys,
  cslToBibtex,
  cslToScholarBibtex,
  cslFromScholarBibtex,
  cslToBibliographyEntry,
  referencesToBib,
  type CslReference,
} from "../csl";

const vaswani: CslReference = {
  type: "article-journal",
  title: "Attention Is All You Need",
  containerTitle: "Advances in Neural Information Processing Systems",
  issued: { year: 2017 },
  contributors: [
    { role: "author", family: "Vaswani", given: "Ashish", sequence: 1 },
    { role: "author", family: "Shazeer", given: "Noam", sequence: 2 },
  ],
  doi: "10.5555/3295222.3295349",
};

describe("csl helpers", () => {
  describe("cslTypeToBibtexType", () => {
    it("maps known CSL types", () => {
      expect(cslTypeToBibtexType("article-journal")).toBe("article");
      expect(cslTypeToBibtexType("paper-conference")).toBe("inproceedings");
      expect(cslTypeToBibtexType("chapter")).toBe("incollection");
      expect(cslTypeToBibtexType("book")).toBe("book");
      expect(cslTypeToBibtexType("thesis")).toBe("phdthesis");
      expect(cslTypeToBibtexType("report")).toBe("techreport");
      expect(cslTypeToBibtexType("manuscript")).toBe("unpublished");
    });

    it("falls back to misc for preprint/unknown/empty", () => {
      expect(cslTypeToBibtexType("preprint")).toBe("misc");
      expect(cslTypeToBibtexType("software")).toBe("misc");
      expect(cslTypeToBibtexType("totally-unknown")).toBe("misc");
      expect(cslTypeToBibtexType(undefined)).toBe("misc");
    });
  });

  describe("formatContributorsBibtex", () => {
    it("joins family/given contributors with ' and ', in sequence order", () => {
      expect(formatContributorsBibtex(vaswani.contributors)).toBe(
        "Vaswani, Ashish and Shazeer, Noam",
      );
    });

    it("respects sequence even when input is unordered", () => {
      const out = formatContributorsBibtex([
        { family: "B", sequence: 2 },
        { family: "A", sequence: 1 },
      ]);
      expect(out).toBe("A and B");
    });

    it("uses literal when family is absent", () => {
      expect(formatContributorsBibtex([{ literal: "Ada Lovelace" }])).toBe("Ada Lovelace");
    });

    it("excludes editors from the author field", () => {
      const out = formatContributorsBibtex([
        { role: "author", family: "Doe", given: "Jane" },
        { role: "editor", family: "Smith", given: "John" },
      ]);
      expect(out).toBe("Doe, Jane");
    });
  });

  describe("deriveCitationKey", () => {
    it("is deterministic: surname + year, lowercased", () => {
      expect(deriveCitationKey(vaswani)).toBe("vaswani2017");
    });

    it("falls back to title slug when no author", () => {
      const key = deriveCitationKey({ type: "book", title: "Deep Learning" });
      expect(key).toBe("deeplearning");
    });
  });

  describe("deriveUniqueCitationKeys", () => {
    it("disambiguates colliding keys with suffixes", () => {
      const a: CslReference = { type: "book", title: "X", contributors: [{ family: "Lee" }], issued: { year: 2020 } };
      const b: CslReference = { type: "book", title: "Y", contributors: [{ family: "Lee" }], issued: { year: 2020 } };
      const keys = deriveUniqueCitationKeys([a, b]);
      expect(keys[0]).toBe("lee2020");
      expect(keys[1]).toBe("lee2020a");
      expect(new Set(keys).size).toBe(2);
    });
  });

  describe("cslToBibtex", () => {
    it("builds an @article entry with journal/author/year/doi", () => {
      const out = cslToBibtex(vaswani, "vaswani2017");
      expect(out).toContain("@article{vaswani2017,");
      expect(out).toContain("author = {Vaswani, Ashish and Shazeer, Noam}");
      expect(out).toContain("title = {Attention Is All You Need}");
      expect(out).toContain("journal = {Advances in Neural Information Processing Systems}");
      expect(out).toContain("year = {2017}");
      expect(out).toContain("doi = {10.5555/3295222.3295349}");
    });

    it("uses booktitle for conference papers", () => {
      const out = cslToBibtex(
        { type: "paper-conference", title: "T", containerTitle: "NeurIPS", issued: { year: 2021 } },
        "k",
      );
      expect(out).toContain("@inproceedings{k,");
      expect(out).toContain("booktitle = {NeurIPS}");
    });

    it("derives an arxiv url from arxivId when url is absent", () => {
      const out = cslToBibtex({ type: "preprint", title: "P", arxivId: "2101.00001" }, "p");
      expect(out).toContain("@misc{p,");
      expect(out).toContain("url = {https://arxiv.org/abs/2101.00001}");
      expect(out).toContain("eprint = {2101.00001}");
    });
  });

  describe("ScholarView CSL preservation", () => {
    it("round-trips canonical CSL through the generated BibTeX artifact", () => {
      const bib = cslToScholarBibtex(vaswani, "vaswani2017");
      expect(bib).toContain("scholarviewcsl = {");
      expect(cslFromScholarBibtex(bib)).toEqual(vaswani);
    });

    it("does not infer CSL from arbitrary hand-authored BibTeX", () => {
      expect(cslFromScholarBibtex("@article{x, title={Legacy}}")).toBeNull();
    });
  });

  describe("cslToBibliographyEntry", () => {
    it("derives title/author/year/url alongside rawBibtex", () => {
      const entry = cslToBibliographyEntry(vaswani, "vaswani2017");
      expect(entry.key).toBe("vaswani2017");
      expect(entry.title).toBe("Attention Is All You Need");
      expect(entry.author).toBe("Vaswani, Ashish and Shazeer, Noam");
      expect(entry.year).toBe("2017");
      expect(entry.rawBibtex).toContain("@article{vaswani2017,");
    });
  });

  describe("referencesToBib", () => {
    it("renders multiple references with unique keys aligned by index", () => {
      const { bib, keys } = referencesToBib([
        vaswani,
        { type: "book", title: "Deep Learning", contributors: [{ family: "Goodfellow" }], issued: { year: 2016 } },
      ]);
      expect(keys).toEqual(["vaswani2017", "goodfellow2016"]);
      expect(bib).toContain("@article{vaswani2017,");
      expect(bib).toContain("@book{goodfellow2016,");
    });
  });
});
