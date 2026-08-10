/*
 * Minori-owned lexicon `pub.paper.reference` (CSL-JSON bibliographic entry),
 * mirrored for local typing. DO NOT add fields — schema is owned by Minori.
 */

import { l } from '@atproto/lex'

const $nsid = 'pub.paper.reference'

export { $nsid }

type Contributor = {
  /** author など */
  role?: string
  /** 表記そのままの著者名 */
  literal?: string
  family?: string
  given?: string
  sequence?: number
}

type Issued = {
  year?: number
}

type Main = {
  $type: 'pub.paper.reference'

  /** CSL type (article-journal / paper-conference / preprint / ...) */
  type: string

  title: string

  /** 掲載誌・会議名 */
  containerTitle?: string

  issued?: Issued

  contributors?: Contributor[]

  doi?: string

  arxivId?: string

  url?: string

  createdAt: l.DatetimeString
}

export type { Main, Contributor, Issued }

const main = l.record<'tid', Main>(
  'tid',
  $nsid,
  l.object({
    type: l.string({ maxLength: 64 }),
    title: l.string({ maxLength: 2000 }),
    containerTitle: l.optional(l.string({ maxLength: 2000 })),
    issued: l.optional(
      l.object({
        year: l.optional(l.integer()),
      }),
    ),
    contributors: l.optional(
      l.array(
        l.object({
          role: l.optional(l.string()),
          literal: l.optional(l.string()),
          family: l.optional(l.string()),
          given: l.optional(l.string()),
          sequence: l.optional(l.integer()),
        }),
      ),
    ),
    doi: l.optional(l.string({ maxLength: 512 })),
    arxivId: l.optional(l.string({ maxLength: 64 })),
    url: l.optional(l.string({ maxLength: 4096 })),
    createdAt: l.string({ format: 'datetime' }),
  }),
)

export { main }
