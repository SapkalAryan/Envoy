'use client';

import { useCallback } from 'react';
import { useAgentStore } from '@/lib/store';

export function useAgent() {
  const store = useAgentStore();

  const run = useCallback(
    async (prompt: string) => {
      store.setStatus('planning');
      store.setLogs([]);
      store.setPlan(null);

      const res = await fetch('/api/agent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        store.setStatus('failed');
        throw new Error(data.error || 'Execution failed');
      }
      store.setPlan(data.plan);
      store.setLogs(data.logs || []);
      store.setStatus(data.record?.status || 'completed');
      return data;
    },
    [store]
  );

  return { ...store, run };
}