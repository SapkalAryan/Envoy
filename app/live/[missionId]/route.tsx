'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Frame {
  data: string;
  timestamp: number;
  width: number;
  height: number;
}

export default function LivePage() {
  const params = useParams();
  const missionId = String(params?.missionId || '');

  const [frame, setFrame] = useState<Frame | null>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'ended' | 'error'>('idle');
  const [fps, setFps] = useState(0);
  const [missionStatus, setMissionStatus] = useState<string>('unknown');
  const [missionPrompt, setMissionPrompt] = useState<string>('');

  const imgRef = useRef<HTMLImageElement | null>(null);
  const frameCount = useRef(0);
  const lastFpsUpdate = useRef(Date.now());

  // Poll mission status
  useEffect(() => {
    if (!missionId) return;
    let alive = true;

    async function poll() {
      try {
        const res = await fetch(`/api/agent/status?id=${missionId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!alive) return;
        if (data.mission) {
          setMissionStatus(data.mission.status || 'unknown');
          setMissionPrompt(data.mission.prompt || '');
        }
      } catch {}
    }

    poll();
    const iv = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, [missionId]);

  // Subscribe to frames
  useEffect(() => {
    if (!missionId) return;
    setStatus('connecting');

    const es = new EventSource(`/api/agent/stream?missionId=${encodeURIComponent(missionId)}`);

    es.onopen = () => setStatus('live');
    es.onmessage = (e) => {
      try {
        const f: Frame = JSON.parse(e.data);
        setFrame(f);
        setStatus('live');
        frameCount.current += 1;
        const now = Date.now();
        if (now - lastFpsUpdate.current >= 1000) {
          setFps(frameCount.current);
          frameCount.current = 0;
          lastFpsUpdate.current = now;
        }
      } catch {}
    };
    es.onerror = () => {
      setStatus((prev) => (prev === 'live' ? 'ended' : 'error'));
      es.close();
    };

    return () => { es.close(); setStatus('idle'); };
  }, [missionId]);

  async function sendInteract(type: string, payload: unknown) {
    if (!missionId) return;
    try {
      await fetch('/api/agent/interact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId, type, payload }),
      });
    } catch {}
  }

  function handleClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!imgRef.current || !frame) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * frame.width;
    const y = ((e.clientY - rect.top) / rect.height) * frame.height;
    sendInteract('click', { x: Math.round(x), y: Math.round(y) });
  }

  function handleKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    if (e.key.length === 1) sendInteract('type', { text: e.key });
    else sendInteract('key', { key: e.key });
  }

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    sendInteract('scroll', { dx: Math.round(e.deltaX), dy: Math.round(e.deltaY) });
  }

  return (
    <main className="min-h-screen flex flex-col bg-bg text-white">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="text-xs text-muted hover:text-white transition"
            >
              ← Back to Console
            </Link>
            <div className="w-px h-4 bg-border" />
            <div className="flex items-center gap-2">
              {status === 'live' && (
                <>
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-xs uppercase tracking-wider">Live</span>
                  <span className="text-xs text-muted font-mono">{fps} fps</span>
                </>
              )}
              {status === 'connecting' && (
                <>
                  <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />
                  <span className="text-xs uppercase tracking-wider">Connecting…</span>
                </>
              )}
              {status === 'ended' && (
                <>
                  <span className="w-2 h-2 rounded-full bg-muted" />
                  <span className="text-xs uppercase tracking-wider text-muted">Ended</span>
                </>
              )}
              {status === 'error' && (
                <>
                  <span className="w-2 h-2 rounded-full bg-danger" />
                  <span className="text-xs uppercase tracking-wider text-danger">Disconnected</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-xs text-muted font-mono">{missionId}</div>
            <div
              className={`text-xs px-2 py-0.5 rounded uppercase tracking-wider ${
                missionStatus === 'completed'
                  ? 'bg-success/20 text-success'
                  : missionStatus === 'failed'
                  ? 'bg-danger/20 text-danger'
                  : missionStatus === 'executing'
                  ? 'bg-warning/20 text-warning'
                  : 'bg-border text-muted'
              }`}
            >
              {missionStatus}
            </div>
          </div>
        </div>
      </header>

      {/* Prompt bar */}
      {missionPrompt && (
        <div className="border-b border-border bg-surface">
          <div className="max-w-[1600px] mx-auto px-6 py-2 text-xs text-muted">
            <span className="text-accent uppercase tracking-wider mr-2">Mission:</span>
            {missionPrompt}
          </div>
        </div>
      )}

      {/* Live viewport */}
      <div
        tabIndex={0}
        onKeyDown={handleKey}
        onWheel={handleWheel}
        className="flex-1 bg-black flex items-center justify-center outline-none relative"
        style={{ minHeight: 'calc(100vh - 100px)' }}
      >
        {frame ? (
          <img
            ref={imgRef}
            src={`data:image/jpeg;base64,${frame.data}`}
            alt="Live browser"
            onClick={handleClick}
            draggable={false}
            className="max-w-full max-h-full object-contain cursor-crosshair select-none"
          />
        ) : (
          <div className="text-muted text-sm flex flex-col items-center gap-3">
            {status === 'connecting' && (
              <>
                <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                <span>Connecting to browser stream…</span>
              </>
            )}
            {status === 'ended' && (
              <>
                <span className="text-2xl">✓</span>
                <span>Mission ended — stream closed</span>
              </>
            )}
            {status === 'error' && (
              <>
                <span className="text-2xl text-danger">!</span>
                <span>Could not connect to stream</span>
                <button
                  onClick={() => window.location.reload()}
                  className="text-xs text-accent hover:underline"
                >
                  Retry
                </button>
              </>
            )}
            {status === 'idle' && <span>Waiting for browser stream…</span>}
          </div>
        )}

        {status === 'live' && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-sm text-xs text-muted px-3 py-1.5 rounded-full border border-border">
            Click inside to interact · Type to send keystrokes
          </div>
        )}
      </div>
    </main>
  );
}