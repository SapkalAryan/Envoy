// lib/types.ts
export type AgentStatus =
  | 'idle'
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'verifying'
  | 'recovering'
  | 'paused'
  | 'completed'
  | 'failed';

export interface MissionGoal {
  id: string;
  prompt: string;
  createdAt: number;
}

export interface PlanStep {
  id: string;
  index: number;
  description: string;
  tool: ToolType;
  target: string;
  params: Record<string, unknown>;
  requiresApproval: boolean;
  status: StepStatus;
  attempts: number;
  maxAttempts: number;
  result?: StepResult;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export type ToolType =
  | 'browser'
  | 'api'
  | 'mcp'
  | 'llm'
  | 'human'
  | 'excel'
  | 'schedule';

export type StepStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'success'
  | 'failed'
  | 'recovered'
  | 'skipped';

export interface StepResult {
  output?: unknown;
  screenshot?: string;
  domSnapshot?: string;
  extracted?: Record<string, unknown>;
}

export interface MissionPlan {
  id: string;
  goal: MissionGoal;
  steps: PlanStep[];
  createdAt: number;
  status: AgentStatus;
  summary: string;
}

export interface LogEntry {
  id: string;
  missionId: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'success' | 'approval';
  stepId?: string;
  message: string;
  data?: unknown;
}

export interface RiskAssessment {
  level: 'safe' | 'sensitive' | 'critical';
  reasons: string[];
  requiresApproval: boolean;
}

export interface MissionRecord {
  id: string;
  prompt: string;
  plan: MissionPlan;
  status: AgentStatus;
  logs: LogEntry[];
  createdAt: number;
  updatedAt: number;
  durationMs?: number;
  metrics?: MissionMetrics;
}

export interface MissionMetrics {
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  recoveredSteps: number;
  approvals: number;
  passRate: number;
  recoveryRate: number;
}