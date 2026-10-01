'use client';

import type { StepStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

const MAP: Record<StepStatus, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'text-muted border-border' },
  running: { label: 'Running', cls: 'text-accent border-accent-dim animate-pulse' },
  awaiting_approval: { label: 'Approval', cls: 'text-warning border-warning/40' },
  success: { label: 'Done', cls: 'text-success border-success/40' },
  failed: { label: 'Failed', cls: 'text-danger border-danger/40' },
  recovered: { label: 'Recovered', cls: 'text-accent border-accent-dim' },
  skipped: { label: 'Skipped', cls: 'text-muted border-border' },
};

export function StatusBadge({ status }: { status: StepStatus }) {
  const cfg = MAP[status] || MAP.pending;
  return (
    <span
      className={cn(
        'text-[10px] uppercase tracking-wider px-2 py-0.5 border rounded shrink-0',
        cfg.cls
      )}
    >
      {cfg.label}
    </span>
  );
}