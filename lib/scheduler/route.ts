// app/api/scheduler/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { listJobs, cancelScheduledJob } from '@/lib/scheduler';
import { parseSchedule, scheduleJob } from '@/lib/scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const jobs = await listJobs();
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, schedule } = body;

    if (!prompt || !schedule) {
      return NextResponse.json(
        { error: 'prompt and schedule required' },
        { status: 400 }
      );
    }

    const parsed = parseSchedule(schedule);
    if (!parsed) {
      return NextResponse.json(
        { error: 'Could not parse schedule' },
        { status: 400 }
      );
    }

    const job = await scheduleJob(prompt, parsed);
    return NextResponse.json({ job });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }
  await cancelScheduledJob(id);
  return NextResponse.json({ ok: true });
}