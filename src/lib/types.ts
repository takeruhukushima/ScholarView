import type { ArticleBlock } from "@/lib/articles/blocks";
import type { BibliographyEntry } from "@/lib/articles/citations";

export type SourceFormat = "markdown" | "tex";
export type WorkspaceFileKind = "folder" | "file";
export type BskyInteractionAction = "like" | "repost" | "reply";

export interface ArticleSummary {
  uri: string;
  did: string;
  rkey: string;
  authorDid: string;
  handle: string | null;
  title: string;
  sourceFormat: SourceFormat;
  broadcasted: 0 | 1;
  createdAt: string;
  announcementUri: string | null;
}

export interface ArticleDetail extends ArticleSummary {
  blocks: ArticleBlock[];
  bibliography: BibliographyEntry[];
  announcementCid: string | null;
}

export interface InlineCommentView {
  uri: string;
  articleUri: string;
  authorDid: string;
  handle: string | null;
  text: string;
  quote: string;
  externalUri: string;
  createdAt: string;
}

export interface DraftArticle {
  id: string;
  title: string;
  content: string;
  sourceFormat: SourceFormat;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceFileNode {
  ownerDid: string;
  id: string;
  parentId: string | null;
  name: string;
  kind: WorkspaceFileKind;
  sourceFormat: SourceFormat | null;
  content: string | null;
  linkedArticleDid: string | null;
  linkedArticleRkey: string | null;
  linkedArticleUri: string | null;
  sortOrder: number;
  expanded: 0 | 1;
  createdAt: string;
  updatedAt: string;
}

export interface BskyInteractionView {
  uri: string;
  subjectUri: string;
  subjectCid: string;
  authorDid: string;
  action: BskyInteractionAction;
  createdAt: string;
}
