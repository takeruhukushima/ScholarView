import type { ArticleAuthor, ArticleBlock, SourceFormat } from "../types";
import type { BibliographyEntry } from "../articles/citations";

export interface WorkspaceFile {
  id: string;
  parentId: string | null;
  name: string;
  kind: "folder" | "file";
  sourceFormat: SourceFormat | null;
  content: string | null;
  linkedArticleDid: string | null;
  linkedArticleRkey: string | null;
  linkedArticleUri: string | null;
  expanded: 0 | 1;
  sortOrder: number;
}

export interface DiscussionPost {
  uri: string;
  cid: string | null;
  handle: string | null;
  authorDid: string;
  text: string;
  quote: string;
  externalUri?: string;
  createdAt: string;
  parentUri: string | null;
  depth: number;
  source: "tap" | "live" | "merged";
  quoted: boolean;
  liked: boolean;
  reposted: boolean;
}

export interface DiscussionRoot {
  uri: string;
  cid: string;
  text: string;
}

export interface ArticleDetailPayload {
  uri: string;
  did: string;
  rkey: string;
  authorDid: string;
  title: string;
  authors: ArticleAuthor[];
  blocks: ArticleBlock[];
  bibliography?: BibliographyEntry[];
  sourceFormat: SourceFormat;
  broadcasted: 0 | 1;
  announcementUri: string | null;
}

export type RightTab = "preview" | "discussion";
export type BlockKind = "paragraph" | "h1" | "h2" | "h3";

export interface EditorBlock {
  id: string;
  kind: BlockKind;
  text: string;
}

export interface CitationMenuState {
  blockId: string;
  start: number;
  end: number;
  query: string;
}

export type TreeDropPosition = "before" | "after" | "inside";
export type NewFileType = "markdown" | "tex" | "bib";
export type ImageDropPosition = "before" | "after";
export type ImageAlign = "left" | "center" | "right";
export type BlockMoveDropTarget = { blockId: string; position: ImageDropPosition };

export interface ParsedMarkdownImageLine {
  alt: string;
  rawSrc: string;
  attrs: string;
}
