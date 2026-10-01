// lib/agent/executor.ts
import type { LogEntry, MissionPlan, MissionRecord, PlanStep } from '../types';
import { uid, now } from '../utils';
import { executeTool } from '../tools/registry';
import { observe } from './observer';
import { verifyStep } from './verifier';
import { recover } from './recovery';
import { replanFromFailure, extractCredentialsFromPrompt } from './replanner';
import {
  appendLog,
  saveMission,
  updateStep,
  replaceMissionPlan,
} from './memory';
import { focusPlaywrightBrowser } from '../focusWindow';

type LogInput = Omit<LogEntry, 'id' | 'missionId' | 'timestamp'>;
type Emit = (log: LogEntry) => void;

export async function runMission(
  plan: MissionPlan,
  emit: Emit
): Promise<MissionRecord> {
  const missionId = plan.id;
  const record: MissionRecord = {
    id: missionId,
    prompt: plan.goal.prompt,
    plan,
    status: 'executing',
    logs: [],
    createdAt: now(),
    updatedAt: now(),
  };
  saveMission(record);

  const log = (entry: LogInput) => {
    const full: LogEntry = {
      id: uid('log_'),
      missionId,
      timestamp: now(),
      ...entry,
    };
    appendLog(missionId, full);
    emit(full);
  };

  const providedCredentials = extractCredentialsFromPrompt(plan.goal.prompt);
  if (providedCredentials.username) {
    console.log(
      `[executor] credentials extracted from prompt — user=${providedCredentials.username}`
    );
  }

  setTimeout(() => {
    focusPlaywrightBrowser().catch(() => {});
  }, 2000);

  log({ level: 'info', message: `Mission started: ${plan.summary}` });

  const completedSteps: PlanStep[] = [];
  let replanAttempts = 0;
  const MAX_REPLANS = 3;
  let lastErrorSignature = '';

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];

    if (step.requiresApproval) {
      log({
        level: 'approval',
        stepId: step.id,
        message: `⚠️ Sensitive step: ${step.description}`,
      });
    }

    step.status = 'running';
    updateStep(missionId, step);

    const ok = await executeStep(step, missionId, log);

    if (ok) {
      completedSteps.push(step);
      lastErrorSignature = '';
      continue;
    }

    if (replanAttempts >= MAX_REPLANS) {
      log({
        level: 'error',
        stepId: step.id,
        message: `Replan limit reached (${MAX_REPLANS}). Failing mission.`,
      });
      record.status = 'failed';
      record.updatedAt = now();
      saveMission(record);
      log({ level: 'error', message: 'Mission failed' });
      return record;
    }

    const errorMsg = step.error || 'Unknown error';

    if (errorMsg.includes('Rejected by user') || errorMsg.includes('cancelled')) {
      record.status = 'failed';
      record.updatedAt = now();
      saveMission(record);
      log({ level: 'error', message: 'Mission failed (user rejected)' });
      return record;
    }

    // ── Same-error loop detection ──
    const errorSignature = `${step.description}::${errorMsg.slice(0, 80)}`;
    if (errorSignature === lastErrorSignature) {
      log({
        level: 'error',
        stepId: step.id,
        message: `Same error repeated — aborting to prevent loop`,
      });
      record.status = 'failed';
      record.updatedAt = now();
      saveMission(record);
      log({ level: 'error', message: 'Mission failed (loop detected)' });
      return record;
    }
    lastErrorSignature = errorSignature;

    log({
      level: 'warn',
      stepId: step.id,
      message: `Step failed — asking Gemini to replan: ${errorMsg.slice(0, 100)}`,
    });

    const currentUrl = step.result?.output
      ? String((step.result.output as any).url || '')
      : '';

    const replanned = await replanFromFailure({
      originalPrompt: plan.goal.prompt,
      completedSteps: completedSteps.map((s) => ({
        description: s.description,
        status: s.status,
      })),
      failedStep: {
        description: step.description,
        error: errorMsg,
        params: step.params,
      },
      currentUrl,
      providedCredentials,
    });

    if (Array.isArray(replanned) && replanned.length === 0) {
      log({
        level: 'success',
        stepId: step.id,
        message: '🎯 Replanner: original goal already achieved — completing mission',
      });
      step.status = 'success';
      step.completedAt = now();
      updateStep(missionId, step);
      completedSteps.push(step);
      break;
    }

    if (!replanned || replanned.length === 0) {
      log({
        level: 'error',
        stepId: step.id,
        message: 'Replanner returned no usable steps — failing mission',
      });
      record.status = 'failed';
      record.updatedAt = now();
      saveMission(record);
      log({ level: 'error', message: 'Mission failed' });
      return record;
    }

    const newSteps: PlanStep[] = replanned.map((s, idx) => {
      const params: Record<string, unknown> = { ...(s.params || {}) };

      if (
        (params.action === 'login' || params.action === 'type') &&
        providedCredentials.username
      ) {
        if (!params.username) params.username = providedCredentials.username;
        if (!params.password && providedCredentials.password) {
          params.password = providedCredentials.password;
        }
        if (params.action === 'type' && !params.text) {
          const instruction = String(params.instruction || '').toLowerCase();
          if (instruction.includes('password')) {
            params.text = providedCredentials.password || '';
          } else if (
            instruction.includes('user') ||
            instruction.includes('email') ||
            instruction.includes('phone')
          ) {
            params.text = providedCredentials.username || '';
          }
        }
      }

      return {
        id: uid('step_'),
        index: plan.steps.length + idx,
        description: s.description,
        tool: s.tool as any,
        target: s.target,
        params,
        requiresApproval: s.requiresApproval,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
      };
    });

    const keptSteps = plan.steps.slice(0, i);
    const replacedPlan = [...keptSteps, ...newSteps];
    plan.steps = replacedPlan;
    replaceMissionPlan(missionId, replacedPlan);
    record.plan = plan;

    log({
      level: 'info',
      stepId: step.id,
      message: `🔄 Plan revised — Gemini added ${newSteps.length} new step(s)`,
    });

    replanAttempts++;
    i--;
  }

  record.status = 'completed';
  record.updatedAt = now();
  record.durationMs = record.updatedAt - record.createdAt;
  record.metrics = computeMetrics(record);
  saveMission(record);
  log({ level: 'success', message: 'Mission completed' });
  return record;
}

async function executeStep(
  step: PlanStep,
  missionId: string,
  log: (entry: LogInput) => void
): Promise<boolean> {
  step.attempts += 1;
  step.startedAt = now();

  step.params = {
    ...(step.params || {}),
    missionId,
    stepId: step.id,
  };

  updateStep(missionId, step);

  try {
    log({ level: 'info', stepId: step.id, message: `Executing: ${step.description}` });
    const result = await executeTool(step);

    const observation = await observe(step);
    const verdict = await verifyStep(step, { ...result, ...observation });

    if (verdict.success) {
      step.status = 'success';
      step.result = result;
      step.completedAt = now();
      updateStep(missionId, step);
      log({
        level: 'success',
        stepId: step.id,
        message: `Step verified (${Math.round(verdict.confidence * 100)}%): ${step.description}`,
        data: { result },
      });
      return true;
    }

    log({
      level: 'warn',
      stepId: step.id,
      message: `Verification failed: ${verdict.reason}`,
    });
    const recovery = await recover(step, verdict.reason);

    if (recovery.strategy === 'abort') {
      step.status = 'failed';
      step.error = verdict.reason;
      updateStep(missionId, step);
      return false;
    }

    if (step.attempts < step.maxAttempts && !step.requiresApproval) {
      return executeStep(step, missionId, log);
    }

    step.status = 'failed';
    step.error = verdict.reason;
    updateStep(missionId, step);
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    log({ level: 'error', stepId: step.id, message: `Step error: ${msg}` });

    if (step.attempts < step.maxAttempts && !step.requiresApproval) {
      return executeStep(step, missionId, log);
    }
    step.status = 'failed';
    step.error = msg;
    updateStep(missionId, step);
    return false;
  }
}

function computeMetrics(record: MissionRecord) {
  const steps = record.plan.steps;
  const passed = steps.filter((s) => s.status === 'success').length;
  const failed = steps.filter((s) => s.status === 'failed').length;
  const recovered = steps.filter((s) => s.status === 'recovered').length;
  const approvals = record.logs.filter((l) => l.level === 'approval').length;
  return {
    totalSteps: steps.length,
    passedSteps: passed,
    failedSteps: failed,
    recoveredSteps: recovered,
    approvals,
    passRate: steps.length ? passed / steps.length : 0,
    recoveryRate: recovered + failed ? recovered / (recovered + failed) : 0,
  };
}