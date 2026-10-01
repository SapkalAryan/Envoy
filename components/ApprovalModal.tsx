'use client';

import { useState, useEffect } from 'react';

interface PendingGate {
  missionId: string;
  stepId: string;
  kind: 'approval' | 'captcha' | 'credentials';
  message: string;
}

export function ApprovalModal({
  gate,
  onResolve,
}: {
  gate: PendingGate | null;
  onResolve: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [focusing, setFocusing] = useState(false);

  useEffect(() => {
    setUsername('');
    setPassword('');
    setElapsed(0);
  }, [gate?.missionId, gate?.stepId, gate?.kind]);

  useEffect(() => {
    if (!gate || gate.kind !== 'captcha') return;
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [gate]);

  if (!gate) return null;

  async function respondApproval(approved: boolean) {
    try {
      await fetch('/api/agent/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId: gate!.missionId,
          stepId: gate!.stepId,
          kind: gate!.kind,
          approved,
        }),
      });
    } catch (e) {
      console.error('[modal] respond error:', e);
    }
    onResolve();
  }

  async function submitCredentials() {
    if (!username || !password) return;
    try {
      await fetch('/api/agent/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId: gate!.missionId,
          stepId: gate!.stepId,
          kind: 'credentials',
          username,
          password,
        }),
      });
    } catch (e) {
      console.error('[modal] credentials error:', e);
    }
    onResolve();
  }

  async function openBrowserTab() {
    setFocusing(true);
    try {
      await fetch('/api/agent/focus-browser', { method: 'POST' });
    } catch (e) {
      console.error('[modal] focus error:', e);
    }
    setTimeout(() => setFocusing(false), 800);
  }

  const isCaptcha = gate.kind === 'captcha';
  const isCredentials = gate.kind === 'credentials';

  // Strip ugly query strings out of the message for display
  const cleanMessage = gate.message.replace(/https?:\/\/[^\s)]+/g, (m) => {
    try {
      const u = new URL(m);
      if (u.pathname === '/' || !u.pathname) return u.origin;
      return `${u.origin}${u.pathname}`;
    } catch {
      return m.split('?')[0].split('#')[0];
    }
  });

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-border bg-surface rounded-xl p-6 shadow-2xl">
        <div
          className={`text-xs uppercase tracking-wider mb-2 ${
            isCaptcha ? 'text-warning' : 'text-accent'
          }`}
        >
          {isCaptcha
            ? '🤖 Captcha Detected'
            : isCredentials
            ? '🔐 Login Required'
            : '🛡 Human Approval Required'}
        </div>

        <div className="text-sm mb-4 whitespace-pre-wrap">{cleanMessage}</div>

        {isCaptcha && (
          <>
            <div className="text-xs text-muted mb-3 border border-border rounded-lg p-3 bg-bg/50">
              <strong className="text-white">What to do:</strong>
              <ol className="mt-2 space-y-1 list-decimal list-inside">
                <li>
                  Click{' '}
                  <button
                    onClick={openBrowserTab}
                    className="text-accent underline hover:no-underline"
                  >
                    Open Browser Tab
                  </button>{' '}
                  below to jump to the Chromium window
                </li>
                <li>Solve the captcha there</li>
                <li>
                  The mission <strong>resumes automatically</strong> once solved
                </li>
              </ol>
            </div>

            <div className="flex items-center justify-between text-xs text-muted mb-3">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />
                Waiting for captcha to be solved…
              </span>
              <span className="font-mono">{elapsed}s</span>
            </div>
          </>
        )}

        {isCredentials && (
          <div className="space-y-3 mb-4">
            <input
              type="text"
              placeholder="Username or email"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
              autoFocus
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
          </div>
        )}

        <div className="flex gap-2 justify-end flex-wrap">
          <button
            onClick={() => respondApproval(false)}
            className="px-4 py-2 text-sm border border-border rounded-lg hover:border-danger hover:text-danger transition"
          >
            {isCaptcha ? 'Abort' : 'Cancel'}
          </button>

          {isCaptcha && (
            <button
              onClick={openBrowserTab}
              disabled={focusing}
              className="px-4 py-2 text-sm border border-accent text-accent rounded-lg hover:bg-accent hover:text-black transition disabled:opacity-40"
            >
              {focusing ? '✓ Focused' : '↗ Open Browser Tab'}
            </button>
          )}

          {isCredentials ? (
            <button
              onClick={submitCredentials}
              disabled={!username || !password}
              className="px-4 py-2 text-sm bg-accent text-black font-medium rounded-lg hover:bg-yellow-400 disabled:opacity-40 transition"
            >
              Submit &amp; Continue
            </button>
          ) : !isCaptcha ? (
            <button
              onClick={() => respondApproval(true)}
              className="px-4 py-2 text-sm bg-accent text-black font-medium rounded-lg hover:bg-yellow-400 transition"
            >
              Approve
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}