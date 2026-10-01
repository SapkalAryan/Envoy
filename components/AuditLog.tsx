'use client';

import type { LogEntry } from '@/lib/types';
import { fmtTime } from '@/lib/utils';

export function AuditLog({ logs }: { logs: LogEntry[] }) {
  function exportJSON() {
    const blob = new Blob([JSON.stringify(logs, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `envoy-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="border border-border rounded-xl bg-surface overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="text-xs text-muted uppercase tracking-wider">Audit & Logging</div>
        <button
          onClick={exportJSON}
          className="text-xs px-2 py-1 border border-border rounded hover:border-accent hover:text-accent transition"
        >
          Export JSON
        </button>
      </div>
      <ul className="divide-y divide-border max-h-[32rem] overflow-y-auto">
        {logs.length === 0 && (
          <li className="px-5 py-6 text-xs text-muted text-center">No entries</li>
        )}
        {logs.map((l) => (
          <li key={l.id} className="px-5 py-3 text-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-muted">{fmtTime(l.timestamp)}</span>
              <span className="uppercase tracking-wider text-muted">{l.level}</span>
            </div>
            <div className="text-white/90">{l.message}</div>
            {l.stepId && (
              <div className="text-muted mt-1 font-mono">step: {l.stepId.slice(-8)}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}