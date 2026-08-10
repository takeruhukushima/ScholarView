import { describe, it, expect } from "vitest";
import {
  buildCollectionValue,
  buildReferenceValue,
  buildCollectionItemValue,
  buildWorkspaceProjectValue,
  cslReferenceFromRecordValue,
  projectSnapshotHash,
  referenceHash,
  type ProjectSnapshot,
} from "../paper";
import type { CslReference } from "@/lib/articles/csl";

const vaswani: CslReference = {
  type: "article-journal",
  title: "Attention Is All You Need",
  containerTitle: "NeurIPS",
  issued: { year: 2017 },
  contributors: [
    { role: "author", family: "Vaswani", given: "Ashish", sequence: 1 },
    { role: "author", family: "Shazeer", given: "Noam", sequence: 2 },
  ],
  doi: "10.5555/3295222.3295349",
};

describe("paper record builders", () => {
  it("buildCollectionValue stamps $type and omits empty optionals", () => {
    const v = buildCollectionValue({ name: "My Project", purpose: "writing" });
    expect(v.$type).toBe("pub.paper.collection");
    expect(v.name).toBe("My Project");
    expect(v.purpose).toBe("writing");
    expect(v.description).toBeUndefined();
    expect(v.targetVenue).toBeUndefined();
    expect(typeof v.createdAt).toBe("string");
  });

  it("buildReferenceValue produces the Minori CSL shape (no $type on nested)", () => {
    const v = buildReferenceValue(vaswani, "2026-01-01T00:00:00.000Z");
    expect(v.$type).toBe("pub.paper.reference");
    expect(v.type).toBe("article-journal");
    expect(v.title).toBe("Attention Is All You Need");
    expect(v.containerTitle).toBe("NeurIPS");
    expect(v.issued).toEqual({ year: 2017 });
    expect(v.contributors?.[0]).toEqual({
      role: "author",
      family: "Vaswani",
      given: "Ashish",
      sequence: 1,
    });
    expect((v.issued as Record<string, unknown>).$type).toBeUndefined();
    expect(v.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("buildReferenceValue round-trips through cslReferenceFromRecordValue", () => {
    const built = buildReferenceValue(vaswani, "2026-01-01T00:00:00.000Z");
    const parsed = cslReferenceFromRecordValue(built);
    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      type: "article-journal",
      title: "Attention Is All You Need",
      containerTitle: "NeurIPS",
      issued: { year: 2017 },
      doi: "10.5555/3295222.3295349",
    });
    expect(parsed?.contributors).toHaveLength(2);
  });

  it("buildCollectionItemValue builds a plain strongRef edge", () => {
    const v = buildCollectionItemValue({
      collection: { uri: "at://did:plc:x/pub.paper.collection/c1", cid: "bafyCID1" },
      reference: { uri: "at://did:plc:x/pub.paper.reference/r1", cid: "bafyCID2" },
      addedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(v).toEqual({
      $type: "pub.paper.collectionItem",
      collection: { uri: "at://did:plc:x/pub.paper.collection/c1", cid: "bafyCID1" },
      reference: { uri: "at://did:plc:x/pub.paper.reference/r1", cid: "bafyCID2" },
      addedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("buildWorkspaceProjectValue carries path, nodes and bib placements", () => {
    const v = buildWorkspaceProjectValue({
      collectionUri: "at://did:plc:x/pub.paper.collection/c1",
      path: "/research/paperA",
      nodes: [
        { path: "figures", kind: "folder", sortOrder: 0 },
        { path: "figures/fig1.png", kind: "file", sortOrder: 0 },
      ],
      bibPlacements: [
        { referenceUri: "at://did:plc:x/pub.paper.reference/r1", bibPath: "refs.bib" },
      ],
    });
    expect(v.$type).toBe("sci.peer.workspaceProject");
    expect(v.collectionUri).toBe("at://did:plc:x/pub.paper.collection/c1");
    expect(v.path).toBe("/research/paperA");
    expect(v.nodes).toHaveLength(2);
    expect(v.bibPlacements?.[0].bibPath).toBe("refs.bib");
  });
});

describe("cslReferenceFromRecordValue (defensive)", () => {
  it("returns null for non-objects and untitled records", () => {
    expect(cslReferenceFromRecordValue(null)).toBeNull();
    expect(cslReferenceFromRecordValue("x")).toBeNull();
    expect(cslReferenceFromRecordValue({ type: "book" })).toBeNull();
  });

  it("tolerates missing type (defaults to misc) and extra fields", () => {
    const parsed = cslReferenceFromRecordValue({
      title: "T",
      unknownMinoriField: 123,
      contributors: [{ literal: "Ada" }, "junk"],
    });
    expect(parsed?.type).toBe("misc");
    expect(parsed?.title).toBe("T");
    expect(parsed?.contributors).toEqual([{ literal: "Ada" }]);
  });
});

describe("idempotency hashes", () => {
  it("projectSnapshotHash is order-independent for nodes and references", () => {
    const base: ProjectSnapshot = {
      name: "P",
      path: "/P",
      nodes: [
        { path: "a", kind: "folder" },
        { path: "b", kind: "file" },
      ],
      references: [vaswani, { type: "book", title: "Deep Learning" }],
    };
    const shuffled: ProjectSnapshot = {
      ...base,
      nodes: [...base.nodes].reverse(),
      references: [...base.references].reverse(),
    };
    expect(projectSnapshotHash(base)).toBe(projectSnapshotHash(shuffled));
  });

  it("projectSnapshotHash changes when a reference changes", () => {
    const a: ProjectSnapshot = { name: "P", path: "/P", nodes: [], references: [vaswani] };
    const b: ProjectSnapshot = {
      name: "P",
      path: "/P",
      nodes: [],
      references: [{ ...vaswani, title: "Different" }],
    };
    expect(projectSnapshotHash(a)).not.toBe(projectSnapshotHash(b));
  });

  it("referenceHash is stable and distinguishes edits", () => {
    expect(referenceHash(vaswani)).toBe(referenceHash({ ...vaswani }));
    expect(referenceHash(vaswani)).not.toBe(referenceHash({ ...vaswani, doi: "10.1/x" }));
  });
});
