import { NextRequest, NextResponse } from 'next/server';
import { getMission, listMissions } from '@/lib/agent/memory';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (id) {
    const mission = getMission(id);
    if (!mission) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ mission });
  }
  return NextResponse.json({ missions: listMissions() });
}