import { NextResponse } from 'next/server';
import { listMissions } from '@/lib/agent/memory';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ workflows: listMissions() });
}