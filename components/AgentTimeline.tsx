'use client';

import type { LogEntry } from '@/lib/types';
import { fmtTime } from '@/lib/utils';

const COLOR: Record<LogEntry['level'], string> = {
  info: 'text-muted',
  warn: 'text-warning',
  error: 'text-danger',
  success: 'text-success',
  approval: 'text-accent',
};

export function AgentTimeline({ logs }: { logs: LogEntry[] }) {
  return (
    <div className="border border-border rounded-xl bg-surface overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <div className="text-xs text-muted uppercase tracking-wider">Live Agent Timeline</div>
      </div>
      <div className="max-h-96 overflow-y-auto">
        {logs.length === 0 && (
          <div className="px-5 py-10 text-center text-sm text-muted">
            No activity yet. Run a mission to see the agent work.
          </div>
        )}
        <ul className="divide-y divide-border">
          {logs.map((l) => (
            <li key={l.id} className="px-5 py-3 flex items-start gap-4 text-sm">
              <span className="text-xs text-muted font-mono shrink-0 mt-0.5">
                {fmtTime(l.timestamp)}
              </span>
              <span className={`${COLOR[l.level]} flex-1`}>{l.message}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}