// src/app/guest/[key]/did.json/route.ts
import { NextResponse } from 'next/server'
import { GUEST_DOMAIN, GUEST_DID_PREFIX } from '@/lib/guest-identity'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;

  if (!key.startsWith('z')) {
    return NextResponse.json({ error: 'Invalid public key' }, { status: 400 })
  }

  const did = `${GUEST_DID_PREFIX}${key}`

  const didDocument = {
    "@context": [
      "https://www.w3.org/ns/did/v1"
    ],
    "id": did,
    "alsoKnownAs": [],
    "verificationMethod": [
      {
        "id": `${did}#atproto`,
        "type": "Multikey",
        "controller": did,
        "publicKeyMultibase": key
      }
    ],
    "service": [
      {
        "id": "#atproto_pds",
        "type": "AtprotoPersonalDataServer",
        "serviceEndpoint": `https://${GUEST_DOMAIN}`
      }
    ]
  }

  return NextResponse.json(didDocument)
}
