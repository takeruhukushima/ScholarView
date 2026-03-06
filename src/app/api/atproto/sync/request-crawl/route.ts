import { NextResponse } from 'next/server';
import { requestRelayCrawl } from '@/lib/atproto-server';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const repo = typeof body.repo === 'string' ? body.repo : undefined;

    // Only allow crawl requests for our own domain
    await requestRelayCrawl("scholar-view.vercel.app", repo);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to request relay crawl:', err);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
