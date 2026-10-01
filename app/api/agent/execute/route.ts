import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createPlan } from '@/lib/agent/planner';
import { runMission } from '@/lib/agent/executor';
import { getMission } from '@/lib/agent/memory';

// Ensure the scheduler heartbeat is running
import('@/lib/scheduler').then((m) => {
  m.startSchedulerHeartbeat();
}).catch(() => {});

export const runtime = 'nodejs';
export const maxDuration = 300;

const Body = z.object({
  prompt: z.string().min(3).max(2000),
});

export async function POST(req: NextRequest) {
  try {
    const { prompt } = Body.parse(await req.json());

    const plan = await createPlan(prompt);

    // ⚠️ Fire-and-forget. NO await.
    runMission(plan, () => {}).catch((e) =>
      console.error('[execute] mission error:', e)
    );

    // Return immediately with plan + missionId
    return NextResponse.json({ plan, missionId: plan.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Execution failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const mission = getMission(id);
  if (!mission) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ mission });
}