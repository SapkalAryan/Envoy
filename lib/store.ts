import { create } from 'zustand';
import type { LogEntry, MissionPlan, MissionRecord, AgentStatus } from './types';

interface AgentStore {
  currentPlan: MissionPlan | null;
  logs: LogEntry[];
  history: MissionRecord[];
  status: AgentStatus;
  setPlan: (plan: MissionPlan | null) => void;
  appendLog: (log: LogEntry) => void;
  setLogs: (logs: LogEntry[]) => void;
  addHistory: (record: MissionRecord) => void;
  setStatus: (status: AgentStatus) => void;
  reset: () => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  currentPlan: null,
  logs: [],
  history: [],
  status: 'idle',
  setPlan: (plan) => set({ currentPlan: plan }),
  appendLog: (log) => set((s) => ({ logs: [...s.logs, log] })),
  setLogs: (logs) => set({ logs }),
  addHistory: (record) => set((s) => ({ history: [record, ...s.history].slice(0, 50) })),
  setStatus: (status) => set({ status }),
  reset: () => set({ currentPlan: null, logs: [], status: 'idle' }),
}));