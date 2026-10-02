'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { CommandInput } from '@/components/CommandInput';
import { AgentTimeline } from '@/components/AgentTimeline';
import { PlanViewer } from '@/components/PlanViewer';
import { AuditLog } from '@/components/AuditLog';
import { ApprovalModal } from '@/components/ApprovalModal';
import { useAgentStore } from '@/lib/store';
import type { LogEntry, MissionRecord, MissionPlan } from '@/lib/types';
import { ScheduledJobs } from '@/components/ScheduledJobs';
import { OpenLiveButton } from '@/components/OpenLiveButton';

interface PendingGate {
  missionId: string;
  stepId: string;
  kind: 'approval' | 'captcha';
  message: string;
}

export default function DashboardPage() {
  const [running, setRunning] = useState(false);
  const [missionId, setMissionId] = useState<string | null>(null);
  const [gate, setGate] = useState<PendingGate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { currentPlan, logs, setPlan, setLogs, setStatus, status } = useAgentStore();

  const gatePollRef = useRef<NodeJS.Timeout | null>(null);
  const statusPollRef = useRef<NodeJS.Timeout | null>(null);
  const seenLogIds = useRef<Set<string>>(new Set());

  const run = useCallback(
    async (prompt: string) => {
      setError(null);
      setPlan(null);
      setLogs([]);
      setStatus('planning');
      seenLogIds.current = new Set();
      setRunning(true);
      setGate(null);
      setMissionId(null);

      try {
        const res = await fetch('/api/agent/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Execution failed');

        setPlan(data.plan as MissionPlan);
        setMissionId(data.missionId as string);
        // Auto-open the live view in a new tab
        window.open(`/live/${data.missionId}`, `envoy-live-${data.missionId}`, 'width=1400,height=900');
        setStatus('executing');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error');
        setStatus('failed');
        setRunning(false);
      }
    },
    [setPlan, setLogs, setStatus]
  );

  // ─── Poll for gates ───
  useEffect(() => {
    if (!running) {
      if (gatePollRef.current) clearInterval(gatePollRef.current);
      setGate(null);
      return;
    }

    const poll = async () => {
      try {
        const res = await fetch('/api/agent/approve', { cache: 'no-store' });
        const data = await res.json();
        console.log('[dashboard] gates:', data.gates);
        const gates: PendingGate[] = data.gates || [];
        setGate(gates.length > 0 ? gates[0] : null);
      } catch (e) {
        console.error('[dashboard] gate poll error:', e);
      }
    };

    poll();
    gatePollRef.current = setInterval(poll, 1200);

    return () => {
      if (gatePollRef.current) clearInterval(gatePollRef.current);
    };
  }, [running]);

  // ─── Poll for status + logs ───
  useEffect(() => {
    if (!running || !missionId) {
      if (statusPollRef.current) clearInterval(statusPollRef.current);
      return;
    }

    statusPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/agent/status?id=${missionId}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json();
        const mission: MissionRecord | undefined = data.mission;
        if (!mission) return;

        const incoming: LogEntry[] = mission.logs || [];
        const fresh: LogEntry[] = [];
        for (const l of incoming) {
          if (!seenLogIds.current.has(l.id)) {
            seenLogIds.current.add(l.id);
            fresh.push(l);
          }
        }
        if (fresh.length > 0) {
          const current = useAgentStore.getState().logs;
          setLogs([...current, ...fresh]);
        }

        setPlan(mission.plan);
        setStatus(mission.status);

        if (mission.status === 'completed' || mission.status === 'failed') {
          setRunning(false);
        }
      } catch { }
    }, 1500);

    return () => {
      if (statusPollRef.current) clearInterval(statusPollRef.current);
    };
  }, [running, missionId, setLogs, setPlan, setStatus]);

  return (
    <main className="min-h-screen">
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-full border-2 border-accent flex items-center justify-center">
              <div className="w-2.5 h-2.5 rounded-full bg-accent" />
            </div>
            <span className="font-semibold tracking-wider text-sm">ENVOY CONSOLE</span>
          </div>
          <div className="text-xs text-muted">
            Status: <span className="text-accent">{status}</span>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <CommandInput onSubmit={run} loading={running} />
          <OpenLiveButton missionId={missionId} />
          {error && (
            <div className="border border-danger/40 bg-danger/10 text-danger text-sm p-4 rounded-lg">
              {error}
            </div>
          )}
          <PlanViewer plan={currentPlan} />
          <AgentTimeline logs={logs} />
        </div>

        <aside className="space-y-6">
          <ScheduledJobs />
          <AuditLog logs={logs} />
        </aside>
      </div>

      <ApprovalModal gate={gate} onResolve={() => setGate(null)} />
    </main>
  );
}