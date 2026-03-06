import { NextResponse } from 'next/server';
import { getAllGuestDids } from '@/lib/firebase-client';

export async function GET() {
  try {
    const repos = await getAllGuestDids();
    
    // The com.atproto.sync.listRepos response format
    return NextResponse.json({
      repos: repos.map(r => ({
        did: r.did,
        head: "bafyreibm7oewyvwx3u2d5o4w5s35f7k5pcfvftd4bpxx6i6mhnxyvdfb4i" // Dummy head CID
      }))
    });

  } catch (err) {
    console.error('Error listing guest repos:', err);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to list repositories' },
      { status: 500 }
    );
  }
}
