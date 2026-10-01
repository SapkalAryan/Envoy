// lib/scheduler/index.ts
import cron from 'node-cron';
import { uid } from '../utils';
import {
  addJob,
  listJobs,
  removeJob,
  updateJob,
  getJobsSync,
  type ScheduledJob,
} from './store';

// ─────────────────────────────────────────────────────────────
// Schedule parser — converts natural language + ISO dates
// into a run time.
// ─────────────────────────────────────────────────────────────
export interface ParsedSchedule {
  runAt: Date;
  recurrence: 'once' | 'daily' | 'weekly' | 'hourly' | 'custom';
  cronExpression?: string;
  humanReadable: string;
}

const DAY_NAMES: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/**
 * Parse a natural-language schedule from the prompt.
 * Examples handled:
 *   "tomorrow at 9am"
 *   "tonight at 8pm"
 *   "in 30 minutes"
 *   "at 6pm"
 *   "every day at 7am"
 *   "every monday at 9am"
 *   "every hour"
 */
export function parseSchedule(input: string): ParsedSchedule | null {
  const text = input.toLowerCase().trim();
  const now = new Date();

  // ─── Recurring: every hour ───
  if (/every\s+hour/i.test(text)) {
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return {
      runAt: next,
      recurrence: 'hourly',
      cronExpression: '0 * * * *',
      humanReadable: 'every hour',
    };
  }

  // ─── Recurring: every day at H:MM [am/pm] ───
  const everyDayMatch = text.match(
    /every\s+day\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i
  );
  if (everyDayMatch) {
    let hour = parseInt(everyDayMatch[1], 10);
    const min = parseInt(everyDayMatch[2] || '0', 10);
    const ampm = everyDayMatch[3]?.toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;

    const next = new Date(now);
    next.setHours(hour, min, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);

    return {
      runAt: next,
      recurrence: 'daily',
      cronExpression: `${min} ${hour} * * *`,
      humanReadable: `every day at ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    };
  }

  // ─── Recurring: every <weekday> at H:MM ───
  const everyWeekdayMatch = text.match(
    /every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i
  );
  if (everyWeekdayMatch) {
    const dayName = everyWeekdayMatch[1].toLowerCase();
    const dayIdx = DAY_NAMES[dayName];
    let hour = parseInt(everyWeekdayMatch[2], 10);
    const min = parseInt(everyWeekdayMatch[3] || '0', 10);
    const ampm = everyWeekdayMatch[4]?.toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;

    const next = new Date(now);
    next.setHours(hour, min, 0, 0);
    const daysUntil = (dayIdx - next.getDay() + 7) % 7 || 7;
    next.setDate(next.getDate() + (next.getTime() <= now.getTime() ? daysUntil : daysUntil - 7));
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 7);

    return {
      runAt: next,
      recurrence: 'weekly',
      cronExpression: `${min} ${hour} * * ${dayIdx}`,
      humanReadable: `every ${dayName} at ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    };
  }

  // ─── "in N minutes/hours" ───
  const inMatch = text.match(/in\s+(\d+)\s+(minute|minutes|hour|hours)/i);
  if (inMatch) {
    const n = parseInt(inMatch[1], 10);
    const unit = inMatch[2].toLowerCase();
    const next = new Date(now);
    if (unit.startsWith('minute')) next.setMinutes(next.getMinutes() + n);
    else next.setHours(next.getHours() + n);

    return {
      runAt: next,
      recurrence: 'once',
      humanReadable: `in ${n} ${unit}`,
    };
  }

  // ─── "tomorrow at H:MM [am/pm]" ───
  const tomorrowMatch = text.match(
    /tomorrow\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i
  );
  if (tomorrowMatch) {
    let hour = parseInt(tomorrowMatch[1], 10);
    const min = parseInt(tomorrowMatch[2] || '0', 10);
    const ampm = tomorrowMatch[3]?.toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;

    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(hour, min, 0, 0);

    return {
      runAt: next,
      recurrence: 'once',
      humanReadable: `tomorrow at ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    };
  }

  // ─── "tonight at H:MM [am/pm]" ───
  const tonightMatch = text.match(/tonight\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (tonightMatch) {
    let hour = parseInt(tonightMatch[1], 10);
    const min = parseInt(tonightMatch[2] || '0', 10);
    const ampm = tonightMatch[3]?.toLowerCase() || 'pm';
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;

    const next = new Date(now);
    next.setHours(hour, min, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);

    return {
      runAt: next,
      recurrence: 'once',
      humanReadable: `tonight at ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    };
  }

  // ─── "today at H:MM" or "at H:MM [am/pm]" ───
  const atMatch = text.match(/(?:today\s+)?at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (atMatch) {
    let hour = parseInt(atMatch[1], 10);
    const min = parseInt(atMatch[2] || '0', 10);
    const ampm = atMatch[3]?.toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;

    const next = new Date(now);
    next.setHours(hour, min, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);

    return {
      runAt: next,
      recurrence: 'once',
      humanReadable: `at ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// Schedule a job
// ─────────────────────────────────────────────────────────────
export async function scheduleJob(
  prompt: string,
  schedule: ParsedSchedule
): Promise<ScheduledJob> {
  const job: ScheduledJob = {
    id: uid('job_'),
    prompt,
    summary: `${schedule.humanReadable} → ${prompt.slice(0, 60)}${prompt.length > 60 ? '…' : ''}`,
    runAt: schedule.runAt.toISOString(),
    cronExpression: schedule.cronExpression,
    recurrence: schedule.recurrence,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    runCount: 0,
  };
  await addJob(job);
  console.log(
    `[scheduler] ✅ scheduled "${job.id}" → runs ${schedule.humanReadable} (${job.runAt})`
  );
  return job;
}

export async function cancelScheduledJob(id: string): Promise<boolean> {
  const job = await removeJob(id);
  console.log(`[scheduler] cancelled job ${id}`);
  return true;
}

export { listJobs };

// ─────────────────────────────────────────────────────────────
// Heartbeat — check every 30 seconds for due jobs
// ─────────────────────────────────────────────────────────────
let heartbeatStarted = false;

export function startSchedulerHeartbeat() {
  if (heartbeatStarted) return;
  heartbeatStarted = true;

  console.log('[scheduler] heartbeat started (checks every 30s)');

  setInterval(async () => {
    try {
      const jobs = getJobsSync();
      const now = Date.now();

      for (const job of jobs) {
        if (job.status !== 'pending') continue;

        const dueAt = new Date(job.runAt).getTime();
        if (dueAt > now) continue;

        console.log(`[scheduler] ⏰ job ${job.id} is due — running mission`);
        await updateJob(job.id, {
          status: 'running',
          lastRunAt: Date.now(),
        });

        try {
          await runScheduledMission(job);
          await updateJob(job.id, {
            status: job.cronExpression ? 'pending' : 'completed',
            runCount: job.runCount + 1,
            lastError: undefined,
          });

          // For recurring jobs, advance runAt
          if (job.cronExpression) {
            const next = getNextCronTime(job.cronExpression);
            await updateJob(job.id, { runAt: next.toISOString() });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown';
          console.error(`[scheduler] job ${job.id} failed: ${msg}`);
          await updateJob(job.id, {
            status: 'failed',
            lastError: msg,
            runCount: job.runCount + 1,
          });
        }
      }
    } catch (err) {
      console.error('[scheduler] heartbeat error:', (err as Error).message);
    }
  }, 30_000);
}

/**
 * Compute the next time a cron expression fires.
 * Supports the "0 M H * * *" style used by our parser.
 */
function getNextCronTime(expr: string): Date {
  const parts = expr.split(/\s+/);
  const now = new Date();
  const next = new Date(now.getTime() + 60_000);

  // For daily: "M H * * *"
  if (parts.length === 5 && parts[2] === '*' && parts[3] === '*' && parts[4] === '*') {
    const min = parseInt(parts[0], 10);
    const hour = parseInt(parts[1], 10);
    next.setHours(hour, min, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next;
  }

  // For weekly: "M H * * D"
  if (parts.length === 5 && parts[2] === '*' && parts[3] === '*' && /^\d+$/.test(parts[4])) {
    const min = parseInt(parts[0], 10);
    const hour = parseInt(parts[1], 10);
    const day = parseInt(parts[4], 10);
    next.setHours(hour, min, 0, 0);
    const daysUntil = (day - next.getDay() + 7) % 7 || 7;
    next.setDate(next.getDate() + daysUntil);
    return next;
  }

  // For hourly: "0 * * * *"
  if (parts.length === 5 && parts[1] === '*') {
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next;
  }

  return next;
}

/**
 * Run the scheduled mission.
 * This dynamically imports the executor to avoid a circular dep at module load.
 */
async function runScheduledMission(job: ScheduledJob): Promise<void> {
  console.log(`[scheduler] running mission for job ${job.id}`);
  const { createPlan } = await import('../agent/planner');
  const { runMission } = await import('../agent/executor');

  const plan = await createPlan(job.prompt);
  await runMission(plan, () => {});

  console.log(`[scheduler] ✅ mission ${plan.id} done for job ${job.id}`);

  // Track the mission ID on the job so users can inspect results
  const { updateJob } = await import('./store');
  await updateJob(job.id, { lastMissionId: plan.id });
}