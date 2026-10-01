// lib/tools/scheduleTool.ts
import type { PlanStep, StepResult } from '../types';
import { parseSchedule, scheduleJob } from '../scheduler';

export async function runScheduleStep(step: PlanStep): Promise<StepResult> {
  const prompt = String(step.params.prompt || step.params.originalPrompt || '');
  const scheduleText = String(step.params.schedule || step.params.when || '');

  if (!prompt) {
    throw new Error('schedule step requires params.prompt (the task to run)');
  }
  if (!scheduleText) {
    throw new Error('schedule step requires params.schedule (e.g. "tomorrow at 9am")');
  }

  const parsed = parseSchedule(scheduleText);
  if (!parsed) {
    throw new Error(
      `Could not parse schedule "${scheduleText}". Try: "tomorrow at 9am", "every day at 7pm", "in 30 minutes".`
    );
  }

  const job = await scheduleJob(prompt, parsed);

  console.log(`[schedule-tool] created job ${job.id}`);

  return {
    output: {
      jobId: job.id,
      runAt: job.runAt,
      recurrence: job.recurrence,
      humanReadable: parsed.humanReadable,
      prompt,
    },
  };
}