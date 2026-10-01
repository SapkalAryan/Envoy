// app/api/agent/focus-browser/route.ts
import { NextResponse } from 'next/server';
import { focusPlaywrightBrowser } from '@/lib/focusWindow';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const focused = await focusPlaywrightBrowser();
    return NextResponse.json({ focused });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'focus failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}