// lib/agent/planner.ts
import type { MissionPlan, PlanStep, ToolType } from '../types';
import { uid, now } from '../utils';
import { assessRisk } from './riskEngine';
import { llmPlan } from './llmPlanner';
import { geminiJSON, isGeminiAvailable } from '../llm/geminiClient';

interface RawPlan {
  summary: string;
  steps: Array<{
    description: string;
    tool: ToolType | 'excel';
    target: string;
    params: Record<string, unknown>;
    requiresApproval: boolean;
  }>;
}

// ─────────────────────────────────────────────────────────────
// Site extraction (used by the rule-based fallback planner)
// ─────────────────────────────────────────────────────────────
function extractSite(prompt: string): { name: string | null; url: string | null } {
  const urlMatch = prompt.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) return { name: null, url: urlMatch[0] };

  const domainMatch = prompt.match(/\b([a-z0-9][a-z0-9-]*\.[a-z]{2,})\b/i);
  if (domainMatch) return { name: null, url: `https://${domainMatch[1]}` };

  const onMatch = prompt.match(/\bon\s+([a-z0-9][a-z0-9-]{1,30})\b/i);
  if (onMatch && !/^(the|a|an|my|this|that|it|them)$/i.test(onMatch[1])) {
    return { name: onMatch[1], url: null };
  }

  const goMatch = prompt.match(
    /\b(?:go\s+to|open|navigate(?:\s+to)?|visit|launch|head\s+to|start)\s+([a-z0-9][a-z0-9-]{1,30})\b/i
  );
  if (goMatch && !/^(the|a|an|my|this|that|web|internet)$/i.test(goMatch[1])) {
    return { name: goMatch[1], url: null };
  }

  return { name: null, url: null };
}

// ─────────────────────────────────────────────────────────────
// Query cleanup helper
// ─────────────────────────────────────────────────────────────
function extractSearchQuery(prompt: string): string | null {
  const m1 = prompt.match(
    /\bsearch(?:\s+for)?\s+(.+?)(?:\s+(?:and|then)\s+(?:add|click|buy|play|open|log|go|navigate)|[.,]|$)/i
  );
  if (m1 && m1[1]) return cleanupQuery(m1[1]);

  const m2 = prompt.match(
    /\b(?:go\s+to|open|visit|navigate(?:\s+to)?|at|on)\s+\S+\s+and\s+(?:search(?:\s+for)?\s+)?(.+)/i
  );
  if (m2 && m2[1]) return cleanupQuery(m2[1]);

  const m3 = prompt.match(/\bfor\s+(.+)/i);
  if (m3 && m3[1]) return cleanupQuery(m3[1]);

  return null;
}

function cleanupQuery(raw: string): string {
  return raw
    .replace(/^(?:for|the|a|an)\s+/i, '')
    .replace(/["'`]+/g, '')
    .replace(/[.,;:!?]+$/, '')
    .trim();
}

// ─────────────────────────────────────────────────────────────
// Field extraction helpers
// ─────────────────────────────────────────────────────────────
function extractUsername(prompt: string): string | null {
  const label = prompt.match(
    /(?:username|user|email|number|phone|mobile|id|account)\s+(?:is\s+|=\s*|:\s*)?([^\s,]+)/i
  );
  if (label) return label[1];
  const withMatch = prompt.match(
    /\b(?:with|as|using)\s+([0-9+\-]{6,}|[\w.+-]+@[\w-]+\.[\w.-]+|[a-zA-Z0-9_.-]{4,})/i
  );
  return withMatch ? withMatch[1] : null;
}

function extractPassword(prompt: string): string | null {
  const m = prompt.match(/password\s+(?:is\s+|=\s*|:\s*)?([^\s,]+)/i);
  return m ? m[1] : null;
}

function extractVideoTopic(prompt: string): string | null {
  const m = prompt.match(
    /(?:video|song|movie|track|audio)\s+(?:of|for|on|called|named|about)?\s*(.+)/i
  );
  return m ? m[1].trim() : null;
}

function extractOrdinal(prompt: string): number {
  const lower = prompt.toLowerCase();

  const words: Record<string, number> = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
    sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  };
  for (const [word, n] of Object.entries(words)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(lower)) return n;
  }

  const ordinalMatch = lower.match(/\b(\d+)(?:st|nd|rd|th)\b/);
  if (ordinalMatch) {
    const n = parseInt(ordinalMatch[1], 10);
    if (n >= 1 && n <= 20) return n;
  }

  const numMatch = lower.match(
    /\b(?:number|no\.?|num)\s*(\d+)\b|\bvideo\s*#?\s*(\d+)\b|\bclip\s*#?\s*(\d+)\b/i
  );
  if (numMatch) {
    const n = parseInt(numMatch[1] || numMatch[2] || numMatch[3], 10);
    if (n >= 1 && n <= 20) return n;
  }

  const bareNum = lower.match(/\b(\d{1,2})\b/);
  if (bareNum) {
    const n = parseInt(bareNum[1], 10);
    if (n >= 1 && n <= 20) return n;
  }

  return 1;
}

// ─────────────────────────────────────────────────────────────
// Site-specific login/register paths
// ─────────────────────────────────────────────────────────────
const LOGIN_PATHS: Record<string, string> = {
  github: 'login',
  gitlab: 'users/sign_in',
  linkedin: 'login',
  facebook: 'login',
  instagram: 'accounts/login',
  twitter: 'i/flow/login',
  x: 'i/flow/login',
  reddit: 'login',
  amazon: 'ap/signin',
  flipkart: 'account/login',
  notion: 'login',
  slack: 'signin',
  discord: 'login',
  spotify: 'login',
  netflix: 'login',
};

const REGISTER_PATHS: Record<string, string> = {
  github: 'signup',
  gitlab: 'users/sign_up',
  linkedin: 'signup',
  reddit: 'register',
};

// ─────────────────────────────────────────────────────────────
// Main planner
// ─────────────────────────────────────────────────────────────
export async function createPlan(prompt: string): Promise<MissionPlan> {
  // ─── 1. Try Gemini LLM planner ───
  const llmRaw = await llmPlan(prompt);

  // ─── 2. Fall back to rule-based planner ───
  const raw: RawPlan = llmRaw
    ? (llmRaw as RawPlan)
    : planFromPrompt(prompt);

  console.log(
    llmRaw
      ? '[planner] ✅ using LLM plan'
      : '[planner] ⚠️  using rule-based fallback'
  );

  const steps: PlanStep[] = raw.steps.map((s, i) => {
    const risk = assessRisk(s as any);
    return {
      id: uid('step_'),
      index: i,
      description: s.description,
      tool: s.tool as ToolType,
      target: s.target,
      params: s.params || {},
      requiresApproval: s.requiresApproval || risk.requiresApproval,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
    };
  });

  return {
    id: uid('mission_'),
    goal: { id: uid('goal_'), prompt, createdAt: now() },
    steps,
    createdAt: now(),
    status: 'planning',
    summary: raw.summary || `Mission: ${prompt}`,
  };
}

// ─────────────────────────────────────────────────────────────
// Rule-based fallback planner
// ─────────────────────────────────────────────────────────────
function planFromPrompt(prompt: string): RawPlan {
  const steps: RawPlan['steps'] = [];
  let { name: siteName, url: siteUrl } = extractSite(prompt);

  const hasLogin = /\b(log\s*in|login|sign\s*in|signin)\b/i.test(prompt);
  const hasRegister = /\b(register|sign\s*up|signup|create\s+account)\b/i.test(prompt);
  const hasSearch = /\bsearch\b/i.test(prompt);

  // Broad match: "add to cart" / "add the first one to cart" / "add it to my bag"
  const hasAddToCart = /\badd\b[^.]*\b(cart|bag|basket|trolley)\b/i.test(prompt);

  const hasBuy = /\b(buy|purchase|checkout|place\s+order|proceed\s+to\s+buy)\b/i.test(prompt);
  const hasPlay =
    /\bplay\b/i.test(prompt) &&
    /\b(video|song|movie|track|audio|music|clip)\b/i.test(prompt);
  const hasFirst = /\b(?:the\s+)?first\b/i.test(prompt);
  const hasExtract = /\b(extract|scrape|get\s+the\s+text|read\s+the\s+page)\b/i.test(prompt);

  // ─── Login / register path augmentation ───
  if (siteUrl && (hasLogin || hasRegister)) {
    const hostMatch = siteUrl.match(/^https?:\/\/(?:www\.)?([^.]+)/i);
    const baseName = hostMatch?.[1]?.toLowerCase() || '';
    const urlLower = siteUrl.toLowerCase();
    const alreadyHasLoginPath = /\/login(\/?$|\/|\?)/i.test(urlLower) || /\/signin/i.test(urlLower);
    const alreadyHasRegisterPath = /\/signup|\/register|\/sign_up/i.test(urlLower);

    if (hasLogin && LOGIN_PATHS[baseName] && !alreadyHasLoginPath) {
      siteUrl = siteUrl.replace(/\/+$/, '') + '/' + LOGIN_PATHS[baseName];
      console.log(`[planner] appended login path → ${siteUrl}`);
    } else if (hasRegister && REGISTER_PATHS[baseName] && !alreadyHasRegisterPath) {
      siteUrl = siteUrl.replace(/\/+$/, '') + '/' + REGISTER_PATHS[baseName];
      console.log(`[planner] appended register path → ${siteUrl}`);
    } else if (alreadyHasLoginPath) {
      console.log(`[planner] login path already present → ${siteUrl}`);
    }
  }

  const addNavigateStep = () => {
    if (siteUrl) {
      steps.push({
        description: `Navigate to ${siteUrl}`,
        tool: 'browser',
        target: siteUrl,
        params: { action: 'goto', url: siteUrl },
        requiresApproval: false,
      });
    } else if (siteName) {
      steps.push({
        description: `Open "${siteName}" via search engine`,
        tool: 'browser',
        target: 'search-engine',
        params: { action: 'open_site_by_name', siteName },
        requiresApproval: false,
      });
    }
  };

  // ─── LOGIN ───
  if (hasLogin) {
    const username = extractUsername(prompt) || '';
    const password = extractPassword(prompt) || '';
    addNavigateStep();
    steps.push({
      description: `Log in as "${username || '(missing username)'}"`,
      tool: 'browser',
      target: 'current-page',
      params: { action: 'login', username, password },
      requiresApproval: true,
    });
    return { summary: `Autonomous execution for: ${prompt}`, steps };
  }

  // ─── REGISTER ───
  if (hasRegister) {
    const fields: Record<string, string> = {};
    const email = prompt.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (email) fields.email = email[0];
    const username = extractUsername(prompt);
    if (username) fields.username = username;
    const password = extractPassword(prompt);
    if (password) fields.password = password;
    addNavigateStep();
    steps.push({
      description: 'Fill registration form',
      tool: 'browser',
      target: 'current-page',
      params: { action: 'register', fields },
      requiresApproval: true,
    });
    return { summary: `Autonomous execution for: ${prompt}`, steps };
  }

  // ─── E-COMMERCE (search + click first + add to cart / buy) ───
  if (hasSearch && (hasAddToCart || hasFirst)) {
    const query = extractSearchQuery(prompt) || prompt;
    addNavigateStep();

    steps.push({
      description: `Search for "${query}"`,
      tool: 'browser',
      target: 'current-page',
      params: { action: 'search', query },
      requiresApproval: false,
    });

    steps.push({
      description: 'Click the first product result',
      tool: 'browser',
      target: 'current-page',
      params: { action: 'click', instruction: 'first product result' },
      requiresApproval: false,
    });

    if (hasAddToCart) {
      steps.push({
        description: 'Add the product to cart',
        tool: 'browser',
        target: 'current-page',
        params: { action: 'add_to_cart' },
        requiresApproval: true,
      });
    }

    if (hasBuy) {
      steps.push({
        description: 'Proceed to buy',
        tool: 'browser',
        target: 'current-page',
        params: { action: 'buy' },
        requiresApproval: true,
      });
    }

    return { summary: `Autonomous execution for: ${prompt}`, steps };
  }

  // ─── PLAY VIDEO ───
  if (hasPlay) {
    const query = extractSearchQuery(prompt) || extractVideoTopic(prompt) || '';
    const ordinal = extractOrdinal(prompt);
    const ordinalLabel =
      ordinal === 1 ? '1st' : ordinal === 2 ? '2nd' : ordinal === 3 ? '3rd' : `${ordinal}th`;

    addNavigateStep();
    if (query) {
      steps.push({
        description: `Search for "${query}"`,
        tool: 'browser',
        target: 'current-page',
        params: { action: 'search', query },
        requiresApproval: false,
      });
    }
    steps.push({
      description: `Play the ${ordinalLabel} video`,
      tool: 'browser',
      target: 'current-page',
      params: { action: 'play', ordinal },
      requiresApproval: false,
    });
    return { summary: `Autonomous execution for: ${prompt}`, steps };
  }

  // ─── SEARCH ONLY ───
  if (hasSearch) {
    const query = extractSearchQuery(prompt) || prompt;
    addNavigateStep();
    steps.push({
      description: `Search for "${query}"`,
      tool: 'browser',
      target: 'current-page',
      params: { action: 'search', query },
      requiresApproval: false,
    });
    return { summary: `Autonomous execution for: ${prompt}`, steps };
  }

  // ─── EXTRACT ───
  if (hasExtract) {
    addNavigateStep();
    steps.push({
      description: 'Extract page content',
      tool: 'browser',
      target: 'current-page',
      params: { action: 'extract', instruction: prompt },
      requiresApproval: false,
    });
    return { summary: `Autonomous execution for: ${prompt}`, steps };
  }

  // ─── GOTO ONLY ───
  if (siteName || siteUrl) {
    addNavigateStep();
    return { summary: `Autonomous execution for: ${prompt}`, steps };
  }

  // ─── FALLBACK: search the raw prompt on Google ───
  steps.push({
    description: 'Search Google for the goal',
    tool: 'browser',
    target: 'https://www.google.com',
    params: { action: 'search', url: 'https://www.google.com', query: prompt },
    requiresApproval: false,
  });
  return { summary: `Autonomous execution for: ${prompt}`, steps };
}