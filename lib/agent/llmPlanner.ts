// lib/agent/llmPlanner.ts
import { geminiJSON, isGeminiAvailable } from '../llm/geminiClient';
import type { ToolType } from '../types';

const SYSTEM_PROMPT = `You are ENVOY's planner. Convert a user's goal into atomic executable steps.

Available tools:
- "browser": Playwright browser automation. Use for ANY website interaction.
- "api": direct REST API calls to known SaaS.
- "llm": reasoning/extraction subtask.
- "mcp": MCP server tools (filesystem, excel).
- "excel": native Excel creation/reading.
- "human": pause for user input.

For browser steps, params.action MUST be one of:
- "goto"             params: { url }
- "search"           params: { query }
- "click"            params: { instruction }
- "type"             params: { instruction, text }
- "play"             params: { ordinal }
- "add_to_cart"      params: {}
- "buy"              params: {}
- "login"            params: { username, password? }
- "register"         params: { fields: { ... } }
- "scroll"           params: { amount? }
- "extract"          params: { instruction }
- "back"             params: {}
- "wait"             params: { ms }

For excel steps:
- tool: "excel"
- params.action: "write" or "read"
- params.filename: "output.xlsx"
- params.headers: ["Col1", "Col2"]
- params.rows: [{ "Col1": "val1", "Col2": "val2" }]

For scheduling:
- tool: "schedule"
- params.prompt: the ORIGINAL task to run (without the schedule part). E.g. "search YouTube for tmkoc"
- params.schedule: the natural-language time phrase. E.g. "tomorrow at 9am", "every day at 7pm"

When the user says things like:
  - "Tomorrow at 9am, do X"
  - "Schedule a task to X every day at 7am"
  - "In 30 minutes, X"
  - "Every Monday at 9am, X"
Emit a SINGLE step with tool: "schedule". Do NOT emit the actual browser steps —
the scheduler will re-plan and execute them at the right time.

For MCP steps:
- tool: "mcp"
- params.server: "filesystem" or "excel"
- params.tool: the tool name
- params.args: object

CRITICAL RULES:
1. Know every website. Resolve names to URLs (amazon -> https://www.amazon.in, youtube -> https://www.youtube.com, github -> https://github.com, instagram -> https://www.instagram.com, flipkart -> https://www.flipkart.com).
2. Split multi-part goals into separate steps.
3. For "go to amazon and search X and add first to cart": goto -> search -> click "first product result" -> add_to_cart.
4. NEVER invent site-specific selectors.
5. Mark requiresApproval=true for: login, register, add_to_cart, buy.
6. Emit 1-8 steps.

Return JSON only:
{
  "summary": "one-line summary",
  "steps": [
    {
      "description": "...",
      "tool": "browser",
      "target": "...",
      "params": { "action": "..." },
      "requiresApproval": false
    }
  ]
}`;

interface RawStep {
  description: string;
  tool: ToolType | 'excel';
  target: string;
  params: Record<string, unknown>;
  requiresApproval: boolean;
}

interface RawPlan {
  summary: string;
  steps: RawStep[];
}

export async function llmPlan(prompt: string): Promise<RawPlan | null> {
  if (!isGeminiAvailable()) {
    console.log('[llm-planner] Gemini not available - using rule-based');
    return null;
  }

  try {
    console.log('[llm-planner] planning with Gemini');
    const parsed = await geminiJSON<RawPlan>(
      SYSTEM_PROMPT,
      `User goal: "${prompt}"\n\nReturn the JSON plan.`,
      { temperature: 0.2, maxTokens: 2048 }
    );

    if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      console.log('[llm-planner] empty plan - falling back');
      return null;
    }

    console.log(`[llm-planner] generated ${parsed.steps.length} steps`);
    return parsed;
  } catch (err) {
    console.error('[llm-planner] error:', (err as Error).message);
    return null;
  }
}