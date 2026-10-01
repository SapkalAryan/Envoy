import type { PlanStep, StepResult } from '../types';

/**
 * Direct REST API connector.
 * In production, resolve credentials from a vault keyed by step.target.
 */
export async function runApiStep(step: PlanStep): Promise<StepResult> {
  // Simulated API call. Replace with real fetch using stored tokens.
  return {
    output: {
      target: step.target,
      endpoint: `https://api.${step.target}.com/v1/action`,
      method: 'POST',
      payload: step.params,
      response: { ok: true, id: `rec_${Date.now().toString(36)}` },
    },
  };
}