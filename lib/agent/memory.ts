// lib/agent/memory.ts
import type { LogEntry, MissionRecord, PlanStep } from '../types';

declare global {
  // eslint-disable-next-line no-var
  var __envoyMissions: Map<string, MissionRecord> | undefined;
  // eslint-disable-next-line no-var
  var __envoyGates: Map<string, PendingGate> | undefined;
}

type ApprovalKind = 'approval' | 'captcha' | 'credentials';

export interface PendingGate {
  missionId: string;
  stepId: string;
  kind: ApprovalKind;
  message: string;
  createdAt: number;
  resolve: (result: boolean | { username: string; password: string }) => void;
}

const pendingGates: Map<string, PendingGate> =
  globalThis.__envoyGates ?? (globalThis.__envoyGates = new Map());

const missions: Map<string, MissionRecord> =
  globalThis.__envoyMissions ?? (globalThis.__envoyMissions = new Map());

export function openGate(
  missionId: string,
  stepId: string,
  kind: 'approval' | 'captcha',
  message: string
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const gateId = `${missionId}::${stepId}::${kind}`;
    pendingGates.set(gateId, {
      missionId,
      stepId,
      kind,
      message,
      createdAt: Date.now(),
      resolve: (result) => {
        if (typeof result === 'boolean') resolve(result);
        else resolve(false);
      },
    });
    console.log(`[gate] opened ${gateId}`);
  });
}

export function openCredentialsGate(
  missionId: string,
  stepId: string,
  message: string
): Promise<{ username: string; password: string } | null> {
  return new Promise((resolve) => {
    const gateId = `${missionId}::${stepId}::credentials`;
    pendingGates.set(gateId, {
      missionId,
      stepId,
      kind: 'credentials',
      message,
      createdAt: Date.now(),
      resolve: (result) => {
        if (typeof result === 'object') resolve(result);
        else resolve(null);
      },
    });
    console.log(`[gate] opened ${gateId}`);
  });
}

export function resolveGate(
  missionId: string,
  stepId: string,
  kind: ApprovalKind,
  result: boolean | { username: string; password: string }
): boolean {
  const gateId = `${missionId}::${stepId}::${kind}`;
  const gate = pendingGates.get(gateId);
  if (!gate) return false;
  gate.resolve(result);
  pendingGates.delete(gateId);
  console.log(`[gate] resolved ${gateId}`);
  return true;
}

export function cancelGate(missionId: string, stepId: string, kind: ApprovalKind): boolean {
  const gateId = `${missionId}::${stepId}::${kind}`;
  const gate = pendingGates.get(gateId);
  if (!gate) return false;
  gate.resolve(false);
  pendingGates.delete(gateId);
  console.log(`[gate] cancelled ${gateId}`);
  return true;
}

export function listPendingGates() {
  return Array.from(pendingGates.values()).map((g) => ({
    missionId: g.missionId,
    stepId: g.stepId,
    kind: g.kind,
    message: g.message,
    createdAt: g.createdAt,
  }));
}

export function saveMission(record: MissionRecord) {
  missions.set(record.id, record);
}

export function getMission(id: string): MissionRecord | undefined {
  return missions.get(id);
}

export function listMissions(): MissionRecord[] {
  return Array.from(missions.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function appendLog(missionId: string, log: LogEntry) {
  const m = missions.get(missionId);
  if (m) {
    m.logs.push(log);
    m.updatedAt = Date.now();
  }
}

export function updateStep(missionId: string, step: PlanStep) {
  const m = missions.get(missionId);
  if (m) {
    const idx = m.plan.steps.findIndex((s) => s.id === step.id);
    if (idx >= 0) m.plan.steps[idx] = step;
    m.updatedAt = Date.now();
  }
}

/**
 * Replace the entire plan for a running mission. Used by the dynamic
 * replanner when the current plan fails and needs restructuring.
 */
export function replaceMissionPlan(missionId: string, newSteps: PlanStep[]) {
  const m = missions.get(missionId);
  if (m) {
    m.plan.steps = newSteps;
    m.updatedAt = Date.now();
  }
}