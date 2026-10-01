import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createPlan } from '@/lib/agent/planner';

export const runtime = 'nodejs';

const Body = z.object({
  prompt: z.string().min(3).max(2000),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const { prompt } = Body.parse(json);
    const plan = await createPlan(prompt);
    return NextResponse.json({ plan });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bad request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}