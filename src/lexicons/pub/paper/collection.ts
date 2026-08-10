/*
 * Minori-owned lexicon `pub.paper.collection`, mirrored for local typing.
 * DO NOT add fields here — the schema is owned by Minori and must stay compatible.
 */

import { l } from '@atproto/lex'

const $nsid = 'pub.paper.collection'

export { $nsid }

type Main = {
  $type: 'pub.paper.collection'

  /** プロジェクト名 */
  name: string

  /** 説明（任意） */
  description?: string

  /** writing/reading/teaching/topic/systematicReview/grantApplication/thesis など（任意） */
  purpose?: string

  /** 投稿先（任意） */
  targetVenue?: string

  createdAt: l.DatetimeString
}

export type { Main }

const main = l.record<'tid', Main>(
  'tid',
  $nsid,
  l.object({
    name: l.string({ maxLength: 1000 }),
    description: l.optional(l.string({ maxLength: 10000 })),
    purpose: l.optional(l.string()),
    targetVenue: l.optional(l.string()),
    createdAt: l.string({ format: 'datetime' }),
  }),
)

export { main }
