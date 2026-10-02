// app/api/agent/stream/route.ts
import { NextRequest } from 'next/server';
import { getScreencast } from '@/lib/tools/browserStream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const missionId = req.nextUrl.searchParams.get('missionId');
  if (!missionId) {
    return new Response('missionId required', { status: 400 });
  }

  const session = getScreencast(missionId);
  if (!session) {
    return new Response('no active screencast', { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`: connected\n\n`));

      const unsubscribe = session.subscribe((frame) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        } catch {}
      });

      const keepAlive = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: ping\n\n`)); }
        catch { clearInterval(keepAlive); }
      }, 10000);

      req.signal.addEventListener('abort', () => {
        unsubscribe();
        clearInterval(keepAlive);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}