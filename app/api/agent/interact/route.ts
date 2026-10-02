// app/api/agent/interact/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getScreencast } from '@/lib/tools/browserStream';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { missionId, type, payload } = await req.json();
    if (!missionId) return NextResponse.json({ error: 'missionId required' }, { status: 400 });

    const session = getScreencast(missionId);
    if (!session) return NextResponse.json({ error: 'no active session' }, { status: 404 });

    switch (type) {
      case 'click': await session.click(Number(payload.x), Number(payload.y)); break;
      case 'type': await session.typeText(String(payload.text)); break;
      case 'key': await session.keyPress(String(payload.key)); break;
      case 'scroll': await session.scroll(Number(payload.dx), Number(payload.dy)); break;
      default: return NextResponse.json({ error: 'unknown type' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}