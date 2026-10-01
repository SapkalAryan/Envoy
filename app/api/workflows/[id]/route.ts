import { NextRequest, NextResponse } from 'next/server';
import { getMission } from '@/lib/agent/memory';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const mission = getMission(params.id);
  if (!mission) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ mission });
}