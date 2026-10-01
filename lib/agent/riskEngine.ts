import type { RiskAssessment, ToolType } from '../types';

const CRITICAL_KEYWORDS = [
  'password', 'credential', 'payment', 'pay', 'checkout', 'purchase',
  'delete', 'remove', 'destroy', 'publish', 'send', 'submit',
  'transfer', 'account change', 'close account', 'cancel',
];

const SENSITIVE_KEYWORDS = ['form', 'update', 'create', 'modify', 'change'];

export function assessRisk(step: {
  description: string;
  tool: ToolType;
  target: string;
  params?: Record<string, unknown>;
}): RiskAssessment {
  const text = `${step.description} ${step.target} ${JSON.stringify(step.params || {})}`.toLowerCase();
  const reasons: string[] = [];

  let level: RiskAssessment['level'] = 'safe';

  for (const kw of CRITICAL_KEYWORDS) {
    if (text.includes(kw)) {
      level = 'critical';
      reasons.push(`Matches critical keyword: "${kw}"`);
    }
  }

  if (level === 'safe') {
    for (const kw of SENSITIVE_KEYWORDS) {
      if (text.includes(kw)) {
        level = 'sensitive';
        reasons.push(`Matches sensitive keyword: "${kw}"`);
      }
    }
  }

  return {
    level,
    reasons,
    requiresApproval: level !== 'safe',
  };
}