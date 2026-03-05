import { NextResponse } from 'next/server';
import { GUEST_DID_PREFIX } from '@/lib/guest-identity';
// Use the firebase admin or the client SDK. Since this is an API route, 
// using the initialized client SDK from `src/lib/firebase` is generally fine for public reads,
// but let's use standard firebase-admin if we had it.
// We'll just use our firebase-client module since we only need simple public reads.
import { getGuestRecord } from '@/lib/firebase-client';
import { db } from '@/lib/firebase';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const repo = searchParams.get('repo');
  const collection = searchParams.get('collection');
  const rkey = searchParams.get('rkey');

  if (!db || !db.type) {
    console.error('Firestore db instance is not properly initialized in API route.');
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Database initialization failed' },
      { status: 500 }
    );
  }

  if (!repo || !collection || !rkey) {
    return NextResponse.json(
      { error: 'InvalidRequest', message: 'repo, collection, and rkey are required' },
      { status: 400 }
    );
  }

  // We only serve guest DIDs from this local PDS replacement
  if (!repo.startsWith(GUEST_DID_PREFIX)) {
    return NextResponse.json(
      { error: 'RecordNotFound', message: `Not a local guest repository: ${repo}` },
      { status: 404 }
    );
  }

  try {
    const recordDoc = await getGuestRecord(repo, collection, rkey);
    
    if (!recordDoc) {
      return NextResponse.json(
        { error: 'RecordNotFound', message: `Could not locate record: at://${repo}/${collection}/${rkey}` },
        { status: 404 }
      );
    }

    // The getRecord AT Protocol response format
    return NextResponse.json({
      uri: recordDoc.uri,
      cid: "bafyreibm7oewyvwx3u2d5o4w5s35f7k5pcfvftd4bpxx6i6mhnxyvdfb4i", // dummy CID for now since we don't calculate real CIDs
      value: recordDoc.value
    });

  } catch (err) {
    console.error('Error fetching guest record:', err);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to fetch record' },
      { status: 500 }
    );
  }
}
