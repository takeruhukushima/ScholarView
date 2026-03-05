// src/lib/guest-identity.ts
import { P256Keypair } from '@atproto/crypto'

export const GUEST_DOMAIN = 'scholar-view.vercel.app'
export const GUEST_DID_PREFIX = `did:web:${GUEST_DOMAIN}:guest:`
const STORAGE_KEY = 'scholarview:guest:key'

/**
 * ゲストの身元を localStorage から取得、なければ新規作成します
 */
export async function getOrCreateGuestIdentity() {
  if (typeof window === 'undefined') {
    throw new Error('getOrCreateGuestIdentity can only be called in the browser')
  }

  const stored = localStorage.getItem(STORAGE_KEY)
  
  let keypair: P256Keypair
  if (stored) {
    keypair = await P256Keypair.import(stored, { exportable: true })
  } else {
    keypair = await P256Keypair.create({ exportable: true })
    const exported = await keypair.export()
    const hex = Buffer.from(exported).toString('hex')
    localStorage.setItem(STORAGE_KEY, hex)
  }

  const didKey = keypair.did() 
  const publicKeyMultibase = didKey.replace('did:key:', '')
  const guestDid = `${GUEST_DID_PREFIX}${publicKeyMultibase}`
  
  return {
    did: guestDid,
    keypair,
    publicKeyMultibase
  }
}

/**
 * データを署名する関数
 */
export async function signAsGuest(keypair: P256Keypair, data: string | Uint8Array) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const signature = await keypair.sign(bytes)
  return signature
}

/**
 * ゲストの身元を削除します
 */
export function clearGuestIdentity() {
  localStorage.removeItem(STORAGE_KEY)
}
