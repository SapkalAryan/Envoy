// lib/scheduler/store.ts
import fs from 'fs/promises';
import path from 'path';

const STORE_PATH = process.env.RENDER
  ? '/data/scheduled-jobs.json'
  : path.join(process.cwd(), 'data', 'scheduled-jobs.json');

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ScheduledJob {
  id: string;
  /** The original prompt to re-run */
  prompt: string;
  /** Human-readable summary shown in the UI */
  summary: string;
  /** ISO string — when the job should run next */
  runAt: string;
  /** Cron expression for recurring jobs (optional) */
  cronExpression?: string;
  /** 'once' | 'daily' | 'weekly' | 'hourly' | 'custom' */
  recurrence: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastMissionId?: string;
  lastError?: string;
  runCount: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __envoyJobs: ScheduledJob[] | undefined;
}

let jobs: ScheduledJob[] = [];

// ─────────────────────────────────────────────────────────────
// Load from disk on module init (once)
// ─────────────────────────────────────────────────────────────
async function loadFromDisk(): Promise<void> {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf-8');
    jobs = JSON.parse(raw) as ScheduledJob[];
    console.log(`[scheduler-store] loaded ${jobs.length} job(s) from disk`);
  } catch {
    jobs = [];
    console.log('[scheduler-store] no existing jobs file');
  }
}

async function saveToDisk(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
    await fs.writeFile(STORE_PATH, JSON.stringify(jobs, null, 2), 'utf-8');
  } catch (err) {
    console.error('[scheduler-store] save error:', (err as Error).message);
  }
}

// Kick off the initial load synchronously as best we can
let loaded = false;
async function ensureLoaded() {
  if (loaded) return;
  await loadFromDisk();
  loaded = true;
}
ensureLoaded().catch(() => {});

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────
export async function listJobs(): Promise<ScheduledJob[]> {
  await ensureLoaded();
  return [...jobs].sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime());
}

export async function addJob(job: ScheduledJob): Promise<void> {
  await ensureLoaded();
  jobs.push(job);
  await saveToDisk();
}

export async function updateJob(id: string, patch: Partial<ScheduledJob>): Promise<void> {
  await ensureLoaded();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx < 0) return;
  jobs[idx] = { ...jobs[idx], ...patch, updatedAt: Date.now() };
  await saveToDisk();
}

export async function getJob(id: string): Promise<ScheduledJob | undefined> {
  await ensureLoaded();
  return jobs.find((j) => j.id === id);
}

export async function removeJob(id: string): Promise<void> {
  await ensureLoaded();
  jobs = jobs.filter((j) => j.id !== id);
  await saveToDisk();
}

export function getJobsSync(): ScheduledJob[] {
  return jobs;
}