'use client';

import { useEffect, useState } from 'react';

interface ScheduledJob {
  id: string;
  prompt: string;
  summary: string;
  runAt: string;
  recurrence: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  runCount: number;
  lastRunAt?: number;
  lastMissionId?: string;
  lastError?: string;
}

export function ScheduledJobs() {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const res = await fetch('/api/scheduler', { cache: 'no-store' });
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch (e) {
      console.error('[scheduler-ui] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
  }, []);

  async function cancel(id: string) {
    if (!confirm('Cancel this scheduled job?')) return;
    try {
      await fetch(`/api/scheduler?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      refresh();
    } catch (e) {
      console.error(e);
    }
  }

  if (loading) {
    return (
      <div className="border border-border rounded-xl bg-surface p-5">
        <div className="text-xs text-muted uppercase tracking-wider mb-3">
          Scheduled Tasks
        </div>
        <div className="text-sm text-muted text-center py-3">Loading…</div>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-xl bg-surface overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <div className="text-xs text-muted uppercase tracking-wider">
          Scheduled Tasks ({jobs.length})
        </div>
        <button
          onClick={refresh}
          className="text-xs text-muted hover:text-white transition"
        >
          ⟳
        </button>
      </div>

      {jobs.length === 0 ? (
        <div className="px-5 py-6 text-xs text-muted text-center">
          No scheduled tasks yet.
          <br />
          Try: <span className="text-accent">"Tomorrow at 9am, search YouTube for tmkoc"</span>
        </div>
      ) : (
        <ul className="divide-y divide-border max-h-96 overflow-y-auto">
          {jobs.map((job) => {
            const runAt = new Date(job.runAt);
            const isPast = runAt.getTime() < Date.now();

            return (
              <li key={job.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{job.prompt}</div>
                    <div className="text-xs text-muted mt-1 flex items-center gap-2 flex-wrap">
                      <span
                        className={
                          isPast && job.status === 'pending'
                            ? 'text-warning'
                            : 'text-accent'
                        }
                      >
                        ⏰ {runAt.toLocaleString()}
                      </span>
                      <span className="opacity-50">·</span>
                      <span>{job.recurrence}</span>
                      {job.runCount > 0 && (
                        <>
                          <span className="opacity-50">·</span>
                          <span>ran {job.runCount}×</span>
                        </>
                      )}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider mt-1">
                      <span
                        className={
                          job.status === 'completed'
                            ? 'text-success'
                            : job.status === 'failed'
                            ? 'text-danger'
                            : job.status === 'running'
                            ? 'text-warning'
                            : 'text-muted'
                        }
                      >
                        {job.status}
                      </span>
                      {job.lastError && (
                        <span className="text-danger ml-2 normal-case">
                          {job.lastError.slice(0, 60)}
                        </span>
                      )}
                    </div>
                  </div>
                  {job.status === 'pending' && (
                    <button
                      onClick={() => cancel(job.id)}
                      className="text-xs text-muted hover:text-danger transition shrink-0"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}