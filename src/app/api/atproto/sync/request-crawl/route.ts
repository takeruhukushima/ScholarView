import { NextResponse } from 'next/server';
import { requestRelayCrawl } from '@/lib/atproto-server';

export async function POST() {
  try {
    // Only allow crawl requests for our own domain
    await requestRelayCrawl("scholar-view.vercel.app");
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to request relay crawl:', err);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
