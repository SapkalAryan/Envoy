// lib/tools/browserStream.ts
import type { Page, CDPSession } from 'playwright';

const sessions = new Map<string, ScreencastSession>();

export interface ScreencastFrame {
  data: string;
  timestamp: number;
  width: number;
  height: number;
}

export class ScreencastSession {
  private cdp: CDPSession | null = null;
  private subscribers: Set<(f: ScreencastFrame) => void> = new Set();
  private lastFrame: ScreencastFrame | null = null;
  private stopped = false;

  constructor(private page: Page) {}

  async start() {
    const context = this.page.context();
    this.cdp = await context.newCDPSession(this.page);

    this.cdp.on('Page.screencastFrame', async (params: any) => {
      const frame: ScreencastFrame = {
        data: params.data,
        timestamp: Date.now(),
        width: params.metadata?.deviceWidth ?? 1280,
        height: params.metadata?.deviceHeight ?? 800,
      };
      this.lastFrame = frame;
      for (const sub of this.subscribers) {
        try { sub(frame); } catch {}
      }
      try {
        await this.cdp!.send('Page.screencastFrameAck', { sessionId: params.sessionId });
      } catch {}
    });

    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 55,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 2,
    });

    console.log('[screencast] started');
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    try { await this.cdp?.send('Page.stopScreencast'); } catch {}
  }

  subscribe(cb: (f: ScreencastFrame) => void): () => void {
    this.subscribers.add(cb);
    if (this.lastFrame) {
      try { cb(this.lastFrame); } catch {}
    }
    return () => { this.subscribers.delete(cb); };
  }

  async click(x: number, y: number) { await this.page.mouse.click(x, y); }
  async typeText(text: string) { await this.page.keyboard.type(text); }
  async keyPress(key: string) { await this.page.keyboard.press(key); }
  async scroll(dx: number, dy: number) { await this.page.mouse.wheel(dx, dy); }

  getPage(): Page { return this.page; }
}

export async function registerScreencast(missionId: string, page: Page): Promise<ScreencastSession> {
  const existing = sessions.get(missionId);
  if (existing) return existing;
  const session = new ScreencastSession(page);
  await session.start();
  sessions.set(missionId, session);
  return session;
}

export function getScreencast(missionId: string): ScreencastSession | undefined {
  return sessions.get(missionId);
}

export function unregisterScreencast(missionId: string) {
  const s = sessions.get(missionId);
  if (s) {
    s.stop().catch(() => {});
    sessions.delete(missionId);
  }
}