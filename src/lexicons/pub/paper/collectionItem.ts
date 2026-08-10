/*
 * Minori-owned lexicon `pub.paper.collectionItem` (membership edge linking a
 * reference into a collection), mirrored for local typing. DO NOT add fields.
 */

import { l } from '@atproto/lex'

const $nsid = 'pub.paper.collectionItem'

export { $nsid }

type StrongRef = {
  uri: string
  cid: string
}

type Main = {
  $type: 'pub.paper.collectionItem'

  /** 所属先の pub.paper.collection への strongRef */
  collection: StrongRef

  /** 所属する pub.paper.reference への strongRef */
  reference: StrongRef

  addedAt: l.DatetimeString
}

export type { Main, StrongRef }

const strongRef = l.object({
  uri: l.string({ format: 'at-uri' }),
  cid: l.string({ format: 'cid' }),
})

const main = l.record<'tid', Main>(
  'tid',
  $nsid,
  l.object({
    collection: strongRef,
    reference: strongRef,
    addedAt: l.string({ format: 'datetime' }),
  }),
)

export { main }
