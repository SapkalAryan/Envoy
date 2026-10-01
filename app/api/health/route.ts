// app/api/health/route.ts
import { NextResponse } from 'next/server';
import { startSchedulerHeartbeat } from '@/lib/scheduler';

export const runtime = 'nodejs';

export async function GET() {
  try {
    startSchedulerHeartbeat();
  } catch {}
  return NextResponse.json({ ok: true, service: 'envoy-agent' });
}