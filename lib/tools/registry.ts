// lib/tools/registry.ts
import type { PlanStep, StepResult } from '../types';

export async function executeTool(step: PlanStep): Promise<StepResult> {
  switch (step.tool) {
    case 'browser': {
      const { runBrowserStep } = await import('./browser');
      return runBrowserStep(step);
    }

    case 'api': {
      const { runApiStep } = await import('./apiConnector');
      return runApiStep(step);
    }

    case 'mcp': {
      const { runMcpStep } = await import('./mcpClient');
      return runMcpStep(step);
    }

    case 'excel': {
      const { runExcelStep } = await import('./excelTool');
      return runExcelStep(step);
    }

    case 'llm': {
      return runLlmStep(step);
    }

    case 'human': {
      return { output: { approved: true } };
    }

    case 'schedule': {
      const { runScheduleStep } = await import('./scheduleTool');
      return runScheduleStep(step);
    }

    default:
      throw new Error(`Unknown tool: ${step.tool}`);
  }
}

async function runLlmStep(step: PlanStep): Promise<StepResult> {
  return {
    output: {
      reasoning: `Processed: ${step.description}`,
      params: step.params,
    },
  };
}