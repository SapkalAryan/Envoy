// lib/agent/replanner.ts
import { geminiJSON, isGeminiAvailable } from '../llm/geminiClient';
import type { PlanStep, ToolType } from '../types';

interface ReplanContext {
  originalPrompt: string;
  completedSteps: Array<{
    description: string;
    status: string;
    error?: string;
  }>;
  failedStep: {
    description: string;
    error: string;
    params?: Record<string, unknown>;
  };
  currentUrl: string;
  providedCredentials?: {
    username?: string;
    password?: string;
  };
}

interface ReplannedStep {
  description: string;
  tool: ToolType | 'excel';
  target: string;
  params: Record<string, unknown>;
  requiresApproval: boolean;
}

interface ReplanResult {
  reasoning: string;
  steps: ReplannedStep[];
}

const VALID_TOOLS = ['browser', 'api', 'llm', 'mcp', 'excel', 'human'];
const VALID_BROWSER_ACTIONS = [
  'goto', 'search', 'click', 'type', 'play',
  'add_to_cart', 'buy', 'login', 'register',
  'scroll', 'extract', 'back', 'wait',
];

const SYSTEM_PROMPT = `You are ENVOY's recovery planner. A step failed mid-mission. Produce a REVISED sequence of steps to reach the original goal.

You will receive credentials the user ALREADY provided. You MUST include them verbatim in any "type" or "login" steps. Never ask the user again.

Available tools (tool field must be EXACTLY one of these strings):
- "browser"
- "api"
- "llm"
- "mcp"
- "excel"
- "human"

Browser step params.action must be EXACTLY one of:
"goto" | "search" | "click" | "type" | "play" | "add_to_cart" | "buy" | "login" | "register" | "scroll" | "extract" | "back" | "wait"

Common failure patterns and fixes:

1. "Element is not attached to the DOM" — page navigated mid-action
   → Emit: wait(2000ms) → retry the action. Preserve credentials.

2. Already-logged-in screen (choose-account / profile picker / feed)
   → The goal is achieved. Return "steps": [].

3. "Login did not complete. Browser ended on accounts.google.com/v3/signin/..."
   → The site tried Google SSO. We want the normal email/password form instead.
   → Emit:
     - goto "https://<original-site>/login" (with the classic form URL)
     - click "the 'Sign in with email' or 'Use password' link" (if present)
     - login { username, password }

4. "Could not find search input"
   → click "the search icon or button" → search

5. Timeout/intercepted click
   → click with a different nearby selector

Return JSON strictly:
{
  "reasoning": "short explanation",
  "steps": [
    {
      "description": "clear imperative step",
      "tool": "browser",
      "target": "site name or URL",
      "params": { "action": "goto", "url": "https://..." },
      "requiresApproval": false
    }
  ]
}

CRITICAL:
- The "tool" and "description" fields are REQUIRED on every step. Never omit them.
- params.action is REQUIRED for browser steps.
- If goal is already achieved, return steps: [].
- Never ask for credentials — they were provided.`;

export async function replanFromFailure(ctx: ReplanContext): Promise<ReplannedStep[] | null> {
  if (!isGeminiAvailable()) {
    console.log('[replanner] Gemini not available — skipping');
    return null;
  }

  try {
    console.log('[replanner] asking Gemini for revised steps');

    const credsLine =
      ctx.providedCredentials && (ctx.providedCredentials.username || ctx.providedCredentials.password)
        ? `
CREDENTIALS ALREADY PROVIDED BY USER (use them verbatim):
  username: ${ctx.providedCredentials.username || '(not provided)'}
  password: ${ctx.providedCredentials.password ? '(provided — use literal value when needed)' : '(not provided)'}
`
        : '';

    const userMsg = `
ORIGINAL GOAL: ${ctx.originalPrompt}

COMPLETED STEPS:
${ctx.completedSteps.map((s) => `  ✓ ${s.description} (${s.status})`).join('\n') || '  (none)'}

FAILED STEP: ${ctx.failedStep.description}
ERROR: ${ctx.failedStep.error}
${ctx.failedStep.params ? `FAILED STEP PARAMS: ${JSON.stringify(ctx.failedStep.params)}` : ''}
CURRENT URL: ${ctx.currentUrl}
${credsLine}
Produce a revised plan.
- Every step MUST have a "tool" and a "description".
- Every browser step's params MUST have an "action".
- If the goal is already achieved on the current page, return { "reasoning": "...", "steps": [] }.`;

    const parsed = await geminiJSON<ReplanResult>(
      SYSTEM_PROMPT,
      userMsg,
      { temperature: 0.2, maxTokens: 1500 }
    );

    if (!parsed) {
      console.log('[replanner] Gemini response was not parseable');
      return null;
    }

    if (!Array.isArray(parsed.steps)) {
      console.log('[replanner] parsed.steps is not an array');
      return null;
    }

    if (parsed.steps.length === 0) {
      console.log('[replanner] 🎯 Gemini says goal already achieved');
      console.log(`[replanner] reasoning: ${parsed.reasoning}`);
      return [];
    }

    // ─── Validate every step ───
    const validSteps: ReplannedStep[] = [];
    let invalidCount = 0;

    for (const raw of parsed.steps) {
      const tool = String((raw as any).tool || '').trim();
      const description = String((raw as any).description || '').trim();

      // Reject steps without required fields
      if (!tool || !description) {
        console.log(`[replanner] ⚠️  rejecting step (missing tool or description):`, raw);
        invalidCount++;
        continue;
      }

      if (!VALID_TOOLS.includes(tool)) {
        console.log(`[replanner] ⚠️  rejecting step (unknown tool "${tool}")`);
        invalidCount++;
        continue;
      }

      const params = ((raw as any).params as Record<string, unknown>) || {};

      // For browser steps, params.action must be valid
      if (tool === 'browser') {
        const action = String(params.action || '').trim();
        if (!action || !VALID_BROWSER_ACTIONS.includes(action)) {
          console.log(`[replanner] ⚠️  rejecting browser step (bad action "${action}")`);
          invalidCount++;
          continue;
        }

        // If action is 'goto', url is required
        if (action === 'goto' && !params.url) {
          console.log(`[replanner] ⚠️  rejecting goto step (missing url)`);
          invalidCount++;
          continue;
        }
      }

      validSteps.push({
        description,
        tool: tool as ToolType | 'excel',
        target: String((raw as any).target || 'current-page'),
        params,
        requiresApproval: Boolean((raw as any).requiresApproval),
      });
    }

    if (invalidCount > 0) {
      console.log(`[replanner] rejected ${invalidCount} malformed step(s), ${validSteps.length} valid`);
    }

    if (validSteps.length === 0) {
      console.log('[replanner] no valid steps after filtering — returning null');
      return null;
    }

    console.log(`[replanner] Gemini returned ${validSteps.length} valid recovery steps`);
    console.log(`[replanner] reasoning: ${parsed.reasoning}`);
    return validSteps;
  } catch (err) {
    console.error('[replanner] error:', (err as Error).message);
    return null;
  }
}

export function extractCredentialsFromPrompt(prompt: string): {
  username?: string;
  password?: string;
} {
  const creds: { username?: string; password?: string } = {};

  const userMatch = prompt.match(
    /(?:username|user|email|number|phone|mobile|id|account)\s+(?:is\s+|=\s*|:\s*)?([^\s,]+)/i
  );
  if (userMatch) creds.username = userMatch[1];

  if (!creds.username) {
    const withMatch = prompt.match(
      /\b(?:with|as|using)\s+([0-9+\-]{6,}|[\w.+-]+@[\w-]+\.[\w.-]+|[a-zA-Z0-9_.-]{4,})/i
    );
    if (withMatch) creds.username = withMatch[1];
  }

  const passMatch = prompt.match(/password\s+(?:is\s+|=\s*|:\s*)?([^\s,]+)/i);
  if (passMatch) creds.password = passMatch[1];

  return creds;
}