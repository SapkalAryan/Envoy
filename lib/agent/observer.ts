import type { StepResult } from '../types';

/**
 * Observer extracts page state / DOM data.
 * In production this connects to the browser tool. Here it returns
 * a normalized observation that the verifier can reason about.
 */
export async function observe(step: {
  tool: string;
  target: string;
  params: Record<string, unknown>;
}): Promise<StepResult> {
  // Simulated observation. Replace with real browser/CDP/MCP call.
  return {
    output: {
      observedAt: Date.now(),
      target: step.target,
      tool: step.tool,
      visible: true,
      elements: [],
    },
    domSnapshot: `<html data-target="${step.target}"></html>`,
  };
}