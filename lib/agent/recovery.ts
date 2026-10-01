import { chatJSON } from '../llm/client';
import { RECOVERY_SYSTEM } from '../llm/prompts';
import type { PlanStep } from '../types';

interface RecoveryPlan {
  diagnosis: string;
  strategy: 'retry' | 'renavigate' | 'dismiss_modal' | 'switch_tool' | 'abort';
  params: Record<string, unknown>;
  reasoning: string;
}

export async function recover(
  step: PlanStep,
  error: string
): Promise<RecoveryPlan> {
  if (step.attempts >= step.maxAttempts) {
    return {
      diagnosis: 'Max attempts reached',
      strategy: 'abort',
      params: {},
      reasoning: `Step failed ${step.attempts} times`,
    };
  }

  try {
    return await chatJSON<RecoveryPlan>(
      RECOVERY_SYSTEM,
      JSON.stringify({ step, error, attempt: step.attempts })
    );
  } catch {
    return {
      diagnosis: 'Unknown failure',
      strategy: 'retry',
      params: {},
      reasoning: 'Fallback: retry once',
    };
  }
}