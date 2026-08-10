/*
 * ScholarView-owned lexicon `sci.peer.workspaceProject`.
 * Carries the workspace placement (path + subtree + bib placements) for a
 * pub.paper.collection so folder structure can be restored across devices.
 */

import { l } from '@atproto/lex'

const $nsid = 'sci.peer.workspaceProject'

export { $nsid }

type Node = {
  /** プロジェクトルートからの相対パス（例: figures/fig1.png） */
  path: string
  /** folder | file */
  kind: string
  /** 同一親内での並び順（任意） */
  sortOrder?: number
  /** この file が公開記事本文の場合、その sci.peer.article の at-uri（任意） */
  linkedArticleUri?: string
}

type BibPlacement = {
  /** pub.paper.reference の at-uri */
  referenceUri: string
  /** この reference を書き出す .bib のプロジェクト相対パス */
  bibPath: string
}

type Main = {
  $type: 'sci.peer.workspaceProject'

  /** 対応する pub.paper.collection の at-uri */
  collectionUri: string

  /** プロジェクトルートのワークスペース絶対パス */
  path: string

  /** プロジェクト内部の相対フォルダ/ファイル配置 */
  nodes?: Node[]

  /** reference uri → 生成先 .bib 相対パス */
  bibPlacements?: BibPlacement[]

  createdAt: l.DatetimeString
}

export type { Main, Node, BibPlacement }

const main = l.record<'tid', Main>(
  'tid',
  $nsid,
  l.object({
    collectionUri: l.string({ format: 'at-uri' }),
    path: l.string({ maxLength: 1024 }),
    nodes: l.optional(
      l.array(
        l.object({
          path: l.string({ maxLength: 1024 }),
          kind: l.string(),
          sortOrder: l.optional(l.integer()),
          linkedArticleUri: l.optional(l.string()),
        }),
      ),
    ),
    bibPlacements: l.optional(
      l.array(
        l.object({
          referenceUri: l.string(),
          bibPath: l.string({ maxLength: 1024 }),
        }),
      ),
    ),
    createdAt: l.string({ format: 'datetime' }),
  }),
)

export { main }
