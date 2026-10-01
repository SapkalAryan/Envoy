'use client';

import type { MissionRecord } from '@/lib/types';
import { fmtTime } from '@/lib/utils';

export function WorkflowList({ workflows }: { workflows: MissionRecord[] }) {
  if (!workflows.length) {
    return (
      <div className="text-xs text-muted text-center py-6">No saved workflows yet.</div>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {workflows.map((w) => (
        <li key={w.id} className="px-4 py-3">
          <div className="text-sm truncate">{w.prompt}</div>
          <div className="text-xs text-muted mt-1 font-mono">
            {fmtTime(w.createdAt)} · {w.status}
          </div>
        </li>
      ))}
    </ul>
  );
}