import { chatJSON } from '../llm/client';
import { VERIFIER_SYSTEM } from '../llm/prompts';
import type { PlanStep, StepResult } from '../types';

interface VerifyResult {
  success: boolean;
  confidence: number;
  reason: string;
  anomalies: string[];
}

export async function verifyStep(
  step: PlanStep,
  result: StepResult
): Promise<VerifyResult> {
  try {
    const out = await chatJSON<VerifyResult>(
      VERIFIER_SYSTEM,
      JSON.stringify({
        step: { description: step.description, tool: step.tool, target: step.target },
        observation: result.output,
      })
    );
    return {
      success: !!out.success,
      confidence: out.confidence ?? 0.5,
      reason: out.reason || '',
      anomalies: out.anomalies || [],
    };
  } catch {
    // Deterministic fallback: assume success if we got a result
    return {
      success: !!result.output,
      confidence: 0.6,
      reason: 'Fallback verification (LLM unavailable)',
      anomalies: [],
    };
  }
}