// app/api/agent/approve/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveGate, listPendingGates } from '@/lib/agent/memory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  missionId: z.string().min(1),
  stepId: z.string().min(1),
  kind: z.enum(['approval', 'captcha', 'credentials']),
  approved: z.boolean().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = Body.parse(await req.json());

    if (body.kind === 'credentials') {
      if (!body.username || !body.password) {
        return NextResponse.json(
          { error: 'username and password required' },
          { status: 400 }
        );
      }
      const ok = resolveGate(body.missionId, body.stepId, 'credentials', {
        username: body.username,
        password: body.password,
      });
      return NextResponse.json({ ok });
    }

    const ok = resolveGate(body.missionId, body.stepId, body.kind, !!body.approved);
    return NextResponse.json({ ok });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bad request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({ gates: listPendingGates() });
}