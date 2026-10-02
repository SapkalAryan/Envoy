// lib/tools/browser.ts
import type { PlanStep, StepResult } from '../types';
import { chromium, BrowserContext, Page, ElementHandle } from 'playwright';
import { focusPlaywrightBrowser, focusEnvoyConsole } from '../focusWindow';
import { killStaleChromium, isProfileClear } from '../killChromium';

// ─────────────────────────────────────────────────────────────
const IS_VERCEL = !!process.env.VERCEL;
const IS_RENDER = !!process.env.RENDER;
const FORCE_HEADLESS = process.env.FORCE_HEADLESS === 'true';
const HEADLESS = IS_VERCEL || IS_RENDER || FORCE_HEADLESS;

console.log(
  `[browser] init — VERCEL=${IS_VERCEL} FORCE_HEADLESS=${FORCE_HEADLESS} → headless=${HEADLESS}`
);

// Start the scheduler heartbeat once on module load
import('../scheduler').then((m) => {
  m.startSchedulerHeartbeat();
}).catch(() => {});

// ─────────────────────────────────────────────────────────────
// Persistent session — one Chromium process, one tab per mission
// ─────────────────────────────────────────────────────────────
let sharedContext: BrowserContext | null = null;
let currentMissionId: string | null = null;
let currentPage: Page | null = null;
let contextLaunchPromise: Promise<BrowserContext> | null = null;

async function launchFreshContext(): Promise<BrowserContext> {
  const profileDir = process.env.RENDER
    ? '/data/browser-profile'
    : './data/browser-profile';

  console.log(`[browser] launching persistent context at ${profileDir}`);

  return chromium.launchPersistentContext(profileDir, {
    headless: HEADLESS,
    slowMo: HEADLESS ? 0 : 400,
    viewport: HEADLESS ? { width: 1440, height: 900 } : null,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    args: HEADLESS
      ? []
      : ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  });
}

async function launchWithRetries(maxAttempts = 3): Promise<BrowserContext> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const clear = await isProfileClear();
      if (!clear) {
        console.log(`[browser] attempt ${attempt}: profile locked — killing`);
        await killStaleChromium();
        await new Promise((r) => setTimeout(r, 2500));
      }

      console.log(`[browser] attempt ${attempt}: launching`);
      const ctx = await launchFreshContext();
      console.log(`[browser] ✅ launched on attempt ${attempt}`);
      return ctx;
    } catch (err) {
      lastError = err as Error;
      const msg = lastError.message || '';

      const retryable =
        msg.includes('Opening in existing browser session') ||
        msg.includes('already in use') ||
        msg.includes('ProcessSingleton');

      if (!retryable) throw lastError;

      console.log(`[browser] attempt ${attempt} failed — killing and retrying`);

      if (attempt < maxAttempts) {
        await killStaleChromium();
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  throw lastError || new Error('Failed to launch after retries');
}

async function ensureContext(): Promise<BrowserContext> {
  if (sharedContext) return sharedContext;

  if (!contextLaunchPromise) {
    contextLaunchPromise = launchWithRetries().then(
      (ctx) => {
        sharedContext = ctx;
        ctx.on('close', () => {
          console.log('[browser] persistent context closed');
          sharedContext = null;
          currentPage = null;
          currentMissionId = null;
          contextLaunchPromise = null;
        });
        setTimeout(() => {
          focusPlaywrightBrowser().catch(() => {});
        }, 1500);
        return ctx;
      },
      (err) => {
        contextLaunchPromise = null;
        throw err;
      }
    );
  }

  return contextLaunchPromise;
}

async function getPage(missionId?: string): Promise<Page> {
  const ctx = await ensureContext();

  if (missionId && missionId !== currentMissionId) {
    console.log(`[browser] new mission ${missionId} — opening new tab`);
    currentMissionId = missionId;

    const pages = ctx.pages();
    if (pages.length === 1 && pages[0].url() === 'about:blank') {
      console.log('[browser] reusing lone about:blank tab');
      currentPage = pages[0];
      return pages[0];
    }

    const newPage = await ctx.newPage();
    currentPage = newPage;
    return newPage;
  }

  if (currentPage && !currentPage.isClosed()) return currentPage;

  const newPage = await ctx.newPage();
  currentPage = newPage;
  return newPage;
}

export async function closeBrowserSession() {
  console.log('[browser] closing session');
  if (sharedContext) {
    try { await sharedContext.close(); } catch {}
  }
  sharedContext = null;
  currentPage = null;
  currentMissionId = null;
  contextLaunchPromise = null;
}

export async function resetBrowserSession() {
  console.log('[browser] resetBrowserSession called');
  if (sharedContext) {
    try { await sharedContext.close(); } catch {}
  }
  sharedContext = null;
  currentPage = null;
  currentMissionId = null;
  contextLaunchPromise = null;
  await killStaleChromium();
}

// ─────────────────────────────────────────────────────────────
// Helpers: display, credentials, login wall
// ─────────────────────────────────────────────────────────────
function cleanUrlForDisplay(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (u.pathname === '/' || !u.pathname) return u.origin;
    return `${u.origin}${u.pathname}`;
  } catch {
    return rawUrl.split('?')[0].split('#')[0];
  }
}

async function tryDismissLoginWall(page: Page): Promise<boolean> {
  const closeSelectors = [
    'button[aria-label="Close" i]',
    'button[aria-label="Dismiss" i]',
    'button[class*="close" i]',
    'button[class*="Close" i]',
    '[role="dialog"] button[aria-label*="close" i]',
    '[role="dialog"] button[aria-label*="dismiss" i]',
    'button:has-text("Continue as guest")',
    'button:has-text("Continue as Guest")',
    'button:has-text("Skip")',
    'button:has-text("Not now")',
    'button:has-text("Not Now")',
    'button:has-text("Later")',
    'button:has-text("Maybe later")',
    'a:has-text("Continue as guest")',
    'a:has-text("Skip")',
  ];

  for (const sel of closeSelectors) {
    try {
      const el = await page.$(sel);
      if (el && (await el.isVisible().catch(() => false))) {
        console.log(`[browser] dismissing login wall: ${sel}`);
        await el.click({ force: true, timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(800);
        return true;
      }
    } catch {}
  }

  try {
    const hasDialog = await page.$('[role="dialog"]');
    if (hasDialog && (await hasDialog.isVisible().catch(() => false))) {
      console.log('[browser] dismissing dialog via Escape');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
      return true;
    }
  } catch {}

  return false;
}

async function detectLoginWall(page: Page): Promise<boolean> {
  const selectors = [
    '[role="dialog"]',
    '[role="dialog"] form input[type="password"]',
    'form input[type="password"]',
    'div[class*="login" i][role="dialog"]',
    'div[class*="Login" i][role="dialog"]',
    'div[class*="modal" i] input[type="password"]',
  ];
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && (await el.isVisible().catch(() => false))) {
        return true;
      }
    } catch {}
  }
  return false;
}

async function handleLoginWall(
  page: Page,
  missionId: string,
  stepId: string
): Promise<{ username: string; password: string } | null> {
  if (await isAlreadyLoggedIn(page)) {
    console.log('[browser] already logged in — no login wall');
    return null;
  }

  if (!(await detectLoginWall(page))) return null;

  if (await tryDismissLoginWall(page)) {
    console.log('[browser] login wall dismissed (guest mode)');
    return null;
  }

  console.log('[browser] login wall detected — asking user for credentials');
  try { await focusEnvoyConsole(); } catch {}

  const { openCredentialsGate } = await import('../agent/memory');
  const result = await openCredentialsGate(
    missionId,
    stepId,
    `This site requires you to log in before continuing. Enter your credentials below.`
  );

  if (!result) {
    console.log('[browser] user cancelled credentials');
    return null;
  }
  return result;
}

async function fillCredentials(
  page: Page,
  username: string,
  password: string
): Promise<void> {
  console.log(`[browser] filling credentials user=${username} pass=***`);

  const userField = await findLoginUsernameField(page);
  if (!userField) {
    console.log('[browser] no username field found in login wall');
    return;
  }
  await userField.click();
  await userField.fill(username);
  await page.waitForTimeout(500);

  const passField = await page.$('input[type="password"]');
  if (passField && (await passField.isVisible().catch(() => false))) {
    await passField.click();
    await passField.fill(password);
    await page.waitForTimeout(400);
    await submitForm(page);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }
  await dismissOverlays(page);
}

// ─────────────────────────────────────────────────────────────
// Auth state detection
// ─────────────────────────────────────────────────────────────
async function isAlreadyLoggedIn(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();

  const authFlowPatterns = [
    /\/login/,
    /\/signin/,
    /\/sign_in/,
    /\/signup/,
    /\/register/,
    /\/auth_platform/,
    /\/challenge/,
    /\/accounts\/login/,
    /\/accounts\/onetap/,
    /\/accounts\/password/,
    /\/accounts\/emailsignup/,
    /\/choose-account/,
    /\/account-picker/,
    /\/oauth/,
    /\/sso/,
    /\/onetap/,
  ];

  for (const re of authFlowPatterns) {
    if (re.test(url)) {
      console.log(`[browser] not logged in — URL matches ${re}`);
      return false;
    }
  }

  const chooseAccountTexts = [
    'see everyday moments from your close friends',
    'use another profile',
    'choose an account',
    'switch accounts',
    'continue as',
    'log in to continue',
    'sign in to continue',
    'welcome back',
    'pick an account',
  ];

  const bodyText = await page
    .evaluate(() => document.body.innerText)
    .catch(() => '')
    .then((t) => t.toLowerCase());

  for (const phrase of chooseAccountTexts) {
    if (bodyText.includes(phrase)) {
      console.log(`[browser] not logged in — page text matches "${phrase}"`);
      return false;
    }
  }

  const positiveIndicators = [
    'article[role="presentation"]',
    'svg[aria-label="Home"]',
    'a[href="/direct/inbox/"]',
    'svg[aria-label="Messenger"]',
    'a[href="/explore/"]',
    'main [role="feed"]',
    'nav [aria-label*="profile" i]',
    '[data-testid="feed"]',
  ];

  for (const sel of positiveIndicators) {
    try {
      const el = await page.$(sel);
      if (el && (await el.isVisible().catch(() => false))) {
        console.log(`[browser] logged-in indicator: ${sel}`);
        return true;
      }
    } catch {}
  }

  console.log('[browser] no definitive logged-in indicator — assuming not logged in');
  return false;
}

// ─────────────────────────────────────────────────────────────
// Gate helpers
// ─────────────────────────────────────────────────────────────
async function openGateWithFocus(
  missionId: string,
  stepId: string,
  kind: 'approval' | 'captcha',
  message: string
): Promise<boolean> {
  try { await focusEnvoyConsole(); } catch {}
  const { openGate } = await import('../agent/memory');
  return openGate(missionId, stepId, kind, message);
}

async function waitForSubmitApproval(
  missionId: string,
  stepId: string,
  actionLabel: string,
  currentUrl: string
): Promise<boolean> {
  if (!missionId || !stepId) {
    console.log('[browser] submitGate: missing IDs — skipping gate');
    return true;
  }
  try { await focusEnvoyConsole(); } catch {}
  console.log(`[browser] ⏸ awaiting approval to click "${actionLabel}"`);
  const { openGate } = await import('../agent/memory');
  const approved = await openGate(
    missionId,
    stepId,
    'approval',
    `About to click "${actionLabel}" on ${cleanUrlForDisplay(currentUrl)}. Approve to continue.`
  );
  console.log(`[browser] submitGate ${approved ? '✅ approved' : '❌ rejected'}`);
  setTimeout(() => { focusPlaywrightBrowser().catch(() => {}); }, 300);
  return approved;
}

// ─────────────────────────────────────────────────────────────
// Captcha gate that auto-detects when the user has solved it
// ─────────────────────────────────────────────────────────────
async function waitForCaptchaSolved(
  page: Page,
  missionId: string,
  stepId: string,
  message: string,
  opts?: { maxWaitMs?: number }
): Promise<boolean> {
  if (!missionId || !stepId) {
    console.log('[browser] captcha gate: missing IDs — skipping');
    return true;
  }

  const maxWait = opts?.maxWaitMs ?? 5 * 60 * 1000;
  const startedAt = Date.now();

  try { await focusEnvoyConsole(); } catch {}

  const { openGate, resolveGate } = await import('../agent/memory');

  let resolved = false;
  const gatePromise = openGate(missionId, stepId, 'captcha', message);

  const detection = (async (): Promise<boolean> => {
    while (Date.now() - startedAt < maxWait) {
      await new Promise((r) => setTimeout(r, 2500));
      if (resolved) return true;

      const captcha = await detectCaptcha(page);
      if (!captcha.present) {
        console.log('[browser] captcha auto-cleared — resuming mission');
        resolved = true;
        resolveGate(missionId, stepId, 'captcha', true);
        return true;
      }
    }
    console.log('[browser] captcha wait timed out');
    return false;
  })();

  const userApproved = await gatePromise;
  resolved = true;

  if (!userApproved) {
    console.log('[browser] user cancelled captcha');
    return false;
  }

  await detection.catch(() => {});
  return true;
}

// ─────────────────────────────────────────────────────────────
// Main step runner
// ─────────────────────────────────────────────────────────────
export async function runBrowserStep(step: PlanStep): Promise<StepResult> {
  const missionId = String(step.params.missionId || '');
  const page = await getPage(missionId);

  // Start a screencast for this mission if not already started
  if (missionId) {
    const { getScreencast, registerScreencast } = await import('./browserStream');
    if (!getScreencast(missionId)) {
      try {
        await registerScreencast(missionId, page);
        console.log(`[browser] screencast started for mission ${missionId}`);
      } catch (err) {
        console.log(`[browser] screencast failed: ${(err as Error).message}`);
      }
    }
  }

  try {
    const action = String(step.params.action || 'goto');
    const url = step.params.url as string | undefined;
    const query = (step.params.query as string) || '';
    const stepId = String(step.params.stepId || step.id || '');

    console.log(
      `[browser] ${action}${url ? ` → ${url}` : ''}${query ? ` q="${query}"` : ''} | current=${page.url()}`
    );

    let title = '';
    let finalUrl = '';
    let earlyResult: StepResult | null = null;

    switch (action) {
      case 'open_site_by_name': {
        const siteName = String(step.params.siteName || '');
        if (!siteName) throw new Error('open_site_by_name requires siteName');

        const engines = [
          { url: 'https://duckduckgo.com', ready: 'input[name="q"]' },
          { url: 'https://www.google.com', ready: 'textarea[name="q"]' },
          { url: 'https://www.bing.com', ready: 'input[name="q"]' },
        ];

        let success = false;

        for (const engine of engines) {
          try {
            console.log(`[browser] resolving "${siteName}" via ${engine.url}`);
            await page.goto(engine.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
            await dismissOverlays(page);

            try {
              await page.waitForSelector(engine.ready, { timeout: 5000 });
            } catch {
              continue;
            }

            const field = await page.$(engine.ready);
            if (!field) continue;

            await field.click();
            await field.fill(siteName);
            await page.waitForTimeout(300);
            await field.press('Enter');

            await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
            await page.waitForTimeout(2000);

            const clicked = await clickFirstExternalResult(page, engine.url);
            if (!clicked) continue;

            await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
            await page.waitForTimeout(2000);

            console.log(`[browser] ✅ resolved "${siteName}" → ${page.url()}`);
            success = true;
            break;
          } catch (e) {
            console.log(`[browser] ${engine.url} failed: ${(e as Error).message}`);
          }
        }

        if (!success) throw new Error(`Could not resolve site "${siteName}"`);
        title = await page.title();
        finalUrl = page.url();
        break;
      }

      case 'search': {
        if (url && page.url() !== url && !page.url().startsWith(url)) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        }
        await dismissOverlays(page);

        // Login wall?
        const creds = await handleLoginWall(page, missionId, stepId);
        if (creds) await fillCredentials(page, creds.username, creds.password);

        let safeQuery = (query || '').trim();
        safeQuery = safeQuery.replace(
          /^.*?\b(?:go\s+to|open|visit|navigate(?:\s+to)?)\s+\S+\s+(?:and\s+)?/i,
          ''
        );
        safeQuery = safeQuery.replace(/^\s*search(?:\s+for)?\s+/i, '');
        safeQuery = safeQuery
          .replace(/^["'`]+|["'`]+$/g, '')
          .replace(/[.,;:!?]+$/, '')
          .trim();

        if (!safeQuery) throw new Error('search requires a non-empty query');
        console.log(`[browser] search query: "${safeQuery}"`);

        let field = await findSearchInput(page);
        if (!field) {
          console.log('[browser] search: rule-based finder failed — trying LLM');
          const { pickElementWithLLM } = await import('./browserElementFinder');
          const { handle } = await pickElementWithLLM(page, 'the main search input on this page');
          if (handle) field = handle;
        }
        if (!field) throw new Error(`Could not find a search input on ${page.url()}`);

        await field.scrollIntoViewIfNeeded().catch(() => {});
        await field.click({ force: true }).catch(() => {});
        await field.fill(safeQuery);
        await page.waitForTimeout(300);
        await submitSearch(page, field);
        await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
        await page.waitForTimeout(2000);

        title = await page.title();
        finalUrl = page.url();
        break;
      }

      case 'play': {
        if (url && page.url() !== url) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
        }

        const ordinal = Number(step.params.ordinal || 1);
        console.log(`[browser] play → video #${ordinal}`);

        const target = await findNthVideo(page, ordinal);
        if (!target) throw new Error(`Could not find video #${ordinal}`);

        await target.scrollIntoViewIfNeeded().catch(() => {});
        await target.click({ timeout: 10_000 });
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(3000);

        await ensureVideoPlaying(page);
        await page.waitForTimeout(1500);

        title = await page.title();
        finalUrl = page.url();

        const shot = await screenshotWithoutPausingVideo(page);
        await ensureVideoPlaying(page);

        return {
          output: { url: finalUrl, title, action, query, screenshotUrl: shot, liveUrl: finalUrl },
          screenshot: shot,
          domSnapshot: '',
        };
      }

      case 'login': {
        if (url && page.url() !== url) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        }
        await dismissOverlays(page);

        let username = String(step.params.username || '');
        let password = String(step.params.password || '');

        console.log(`[browser] login user=${username || '(empty)'}`);

        // If no username, ask via credentials gate
        if (!username) {
          try { await focusEnvoyConsole(); } catch {}
          const { openCredentialsGate } = await import('../agent/memory');
          const result = await openCredentialsGate(
            missionId,
            stepId,
            `Log in to ${cleanUrlForDisplay(page.url())}. Enter your credentials below.`
          );
          if (!result) throw new Error('User cancelled credentials');
          username = result.username;
          password = result.password;
        }

        // SSO redirect detection
        const currentUrl = page.url();
        const ssoRedirectPatterns = [
          /accounts\.google\.com/,
          /login\.microsoftonline\.com/,
          /login\.live\.com/,
          /www\.facebook\.com\/login/,
          /appleid\.apple\.com/,
        ];
        const isOnSsoPage = ssoRedirectPatterns.some((re) => re.test(currentUrl));

        if (isOnSsoPage && url) {
          console.log(`[browser] SSO redirect detected — going back to ${url}`);
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
          await dismissOverlays(page);
        }

        // Already logged in?
        await page.waitForTimeout(1000);
        if (await isAlreadyLoggedIn(page)) {
          console.log('[browser] ✅ already logged in — skipping login step');
          title = await page.title();
          finalUrl = page.url();
          break;
        }

        // Handle "choose account" screen
        const chooseAccountSelectors = [
          'button:has-text("Use another profile")',
          'a:has-text("Use another profile")',
          'div[role="button"]:has-text("Use another profile")',
          'button:has-text("Use another account")',
          'button:has-text("Switch account")',
          'button:has-text("Sign in with another")',
          'button:has-text("Continue with password")',
          'button:has-text("Log in with password")',
        ];
        for (const sel of chooseAccountSelectors) {
          try {
            const el = await page.$(sel);
            if (el && (await el.isVisible().catch(() => false))) {
              console.log(`[browser] account-picker detected — clicking "${sel}"`);
              await el.click({ force: true });
              await page.waitForTimeout(2000);
              await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
              break;
            }
          } catch {}
        }

        // 1. Arrival captcha
        await page.waitForTimeout(1500);
        const arrivalCaptcha = await detectCaptcha(page);
        if (arrivalCaptcha.present) {
          console.log(`[browser] ⚠️  Captcha on arrival: ${arrivalCaptcha.kind}`);
          const proceed = await waitForCaptchaSolved(
            page,
            missionId,
            stepId,
            `Captcha (${arrivalCaptcha.kind}) detected. Solve it in the Chromium window — the mission resumes automatically once solved.`
          );
          if (!proceed) throw new Error('User aborted captcha');
        }

        // 2. Find username field with workarounds
        let userField = await findLoginUsernameField(page);

        if (!userField) {
          console.log('[browser] no username field found — trying workarounds');

          const dismissed = await tryDismissLoginWall(page);
          if (dismissed) {
            await page.waitForTimeout(1000);
            userField = await findLoginUsernameField(page);
          }

          if (!userField) {
            const switchSelectors = [
              'button:has-text("Use another profile")',
              'button:has-text("Use another account")',
              'button:has-text("Sign in with another")',
              'button:has-text("Switch account")',
              'button:has-text("Continue with email")',
              'a:has-text("Use another profile")',
              'a:has-text("Switch account")',
            ];
            for (const sel of switchSelectors) {
              try {
                const el = await page.$(sel);
                if (el && (await el.isVisible().catch(() => false))) {
                  console.log(`[browser] workaround: clicking "${sel}"`);
                  await el.click({ force: true }).catch(() => {});
                  await page.waitForTimeout(1500);
                  userField = await findLoginUsernameField(page);
                  if (userField) break;
                }
              } catch {}
            }
          }

          if (!userField) {
            try {
              const { pickElementWithLLM } = await import('./browserElementFinder');
              const { handle } = await pickElementWithLLM(
                page,
                'the username, email, or phone number input field. If you see an "already logged in" screen, look for a "Use another profile" or "Switch account" button instead.'
              );
              if (handle) userField = handle;
            } catch {}
          }
        }

        if (!userField) {
          throw new Error(`No login form found on ${page.url()}.`);
        }

        await userField.click();
        await userField.fill(username);
        await page.waitForTimeout(500);

        // 3. Fill password if visible
        let filledPassword = false;
        if (password) {
          const passField = await page.$('input[type="password"]');
          if (passField && (await passField.isVisible().catch(() => false))) {
            await passField.click();
            await passField.fill(password);
            await page.waitForTimeout(400);
            filledPassword = true;
          }
        }

        // 4. Pre-submit captcha
        const preCaptcha = await detectCaptcha(page);
        if (preCaptcha.present) {
          const proceed = await waitForCaptchaSolved(
            page,
            missionId,
            stepId,
            `Captcha (${preCaptcha.kind}) detected before submit. Solve it — the mission resumes automatically.`
          );
          if (!proceed) throw new Error('User aborted captcha');
        }

        // 5. Approval gate
        const actionLabel = filledPassword ? 'Log in' : 'Next';
        const approved = await waitForSubmitApproval(missionId, stepId, actionLabel, page.url());
        if (!approved) throw new Error('Rejected by user before submit');

        // 6. Submit
        if (filledPassword) {
          await submitForm(page);
          await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
          await page.waitForTimeout(2000);
        } else {
          await submitForm(page);
          await page.waitForTimeout(2000);

          const midCaptcha = await detectCaptcha(page);
          if (midCaptcha.present) {
            const proceed = await waitForCaptchaSolved(
              page,
              missionId,
              stepId,
              `Captcha after Next (${midCaptcha.kind}). Solve it — the mission resumes automatically.`
            );
            if (!proceed) throw new Error('User aborted captcha');
          }

          if (password) {
            const passField2 = await page.$('input[type="password"]');
            if (passField2 && (await passField2.isVisible().catch(() => false))) {
              await passField2.click();
              await passField2.fill(password);
              await page.waitForTimeout(400);

              const approved2 = await waitForSubmitApproval(missionId, stepId, 'Log in', page.url());
              if (!approved2) throw new Error('Rejected by user before submit');

              await submitForm(page);
              await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
              await page.waitForTimeout(2000);
            }
          }
        }

        // 7. Post-submit captcha
        await page.waitForTimeout(3000);
        for (let round = 0; round < 3; round++) {
          const postCaptcha = await detectCaptcha(page);
          const currentUrl2 = page.url();
          const looksLoggedIn =
            !currentUrl2.includes('/login') &&
            !currentUrl2.includes('/signin') &&
            !currentUrl2.includes('/accounts/login') &&
            !currentUrl2.includes('/auth_platform') &&
            !currentUrl2.includes('/challenge') &&
            !currentUrl2.includes('/sso') &&
            !currentUrl2.includes('/oauth');

          if (looksLoggedIn && !postCaptcha.present) break;

          if (postCaptcha.present) {
            const proceed = await waitForCaptchaSolved(
              page,
              missionId,
              stepId,
              `Post-login captcha (${postCaptcha.kind}). Solve it — the mission resumes automatically.`
            );
            if (!proceed) throw new Error('User aborted captcha');
            await page.waitForTimeout(2500);
            await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
            await page.waitForTimeout(1500);
          } else {
            await page.waitForTimeout(2000);
          }
        }

        await dismissOverlays(page);
        await page.waitForTimeout(1200);
        title = await page.title();
        finalUrl = page.url();

        const failurePatterns = [
          /\/login\/login/i, /\/login$/i, /\/signin/i, /\/sign_in/i,
          /\/signup/i, /\/register/i, /\/auth_platform/, /\/challenge/,
          /accounts\.google\.com/, /login\.microsoftonline\.com/, /\/oauth/, /\/sso/,
        ];
        let failed = false;
        for (const re of failurePatterns) {
          if (re.test(finalUrl)) { failed = true; break; }
        }
        if (failed) throw new Error(`Login did not complete. Browser ended on ${finalUrl}.`);

        console.log(`[browser] ✅ login done → "${title}" @ ${finalUrl}`);
        break;
      }

      case 'register': {
        if (url && page.url() !== url) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        }
        await dismissOverlays(page);

        const fields = (step.params.fields as Record<string, string>) || {};

        for (const [label, value] of Object.entries(fields)) {
          const handle = await findInputByLabel(page, label);
          if (handle) {
            await handle.scrollIntoViewIfNeeded().catch(() => {});
            await handle.click();
            await handle.fill(value);
            await page.waitForTimeout(250);
          }
        }

        const preCaptcha = await detectCaptcha(page);
        if (preCaptcha.present) {
          const proceed = await waitForCaptchaSolved(
            page, missionId, stepId,
            `Captcha (${preCaptcha.kind}) detected. Solve it — the mission resumes automatically.`
          );
          if (!proceed) throw new Error('User aborted captcha');
        }

        const approved = await waitForSubmitApproval(missionId, stepId, 'Sign up', page.url());
        if (!approved) throw new Error('Rejected by user before submit');

        await submitForm(page);
        await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(2500);

        const postCaptcha = await detectCaptcha(page);
        if (postCaptcha.present) {
          await waitForCaptchaSolved(
            page, missionId, stepId,
            `Post-register captcha (${postCaptcha.kind}). Solve it — the mission resumes automatically.`
          );
        }

        title = await page.title();
        finalUrl = page.url();
        break;
      }

      case 'goto': {
        if (!url) throw new Error('goto requires url');
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
        await dismissOverlays(page);

        await page.waitForTimeout(1500);
        const captcha = await detectCaptcha(page);
        if (captcha.present) {
          console.log(`[browser] ⚠️  Captcha after goto: ${captcha.kind}`);
          if (missionId && stepId) {
            const proceed = await waitForCaptchaSolved(
              page, missionId, stepId,
              `Captcha (${captcha.kind}) detected. Solve it — the mission resumes automatically.`
            );
            if (!proceed) throw new Error('User aborted captcha');
          }
        }

        title = await page.title();
        finalUrl = page.url();
        break;
      }

      case 'click': {
        if (url && page.url() !== url && !page.url().startsWith(url)) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
        }
        await dismissOverlays(page);

        const creds = await handleLoginWall(page, missionId, stepId);
        if (creds) await fillCredentials(page, creds.username, creds.password);

        const instruction = String(step.params.instruction || step.description);
        console.log(`[browser] clicking: "${instruction}"`);

        let target = await findClickable(page, instruction);
        if (!target) {
          console.log('[browser] click: rule-based finder failed — trying LLM');
          const { pickElementWithLLM } = await import('./browserElementFinder');
          const { handle } = await pickElementWithLLM(page, instruction);
          if (handle) target = handle;
        }
        if (!target) throw new Error(`Could not find: "${instruction}"`);

        await target.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(300);

        const popupPromise = page.context().waitForEvent('page', { timeout: 4000 }).catch(() => null);

        let clicked = false;
        try {
          await target.click({ timeout: 3000 });
          clicked = true;
          console.log('[browser] click: normal');
        } catch (e) {
          console.log(`[browser] click: normal failed — ${(e as Error).message.slice(0, 80)}`);
        }

        if (!clicked) {
          try {
            await target.click({ force: true, timeout: 3000 });
            clicked = true;
            console.log('[browser] click: force');
          } catch (e) {
            console.log(`[browser] click: force failed — ${(e as Error).message.slice(0, 80)}`);
          }
        }

        if (!clicked) {
          try {
            await target.evaluate((el: HTMLElement) => el.click());
            clicked = true;
            console.log('[browser] click: JS dispatch');
          } catch (e) {
            console.log(`[browser] click: JS failed — ${(e as Error).message.slice(0, 80)}`);
          }
        }

        if (!clicked) {
          try {
            const href = await target.evaluate((el: HTMLElement) => {
              const a = el.closest('a') || el.querySelector('a');
              return a ? (a as HTMLAnchorElement).href : '';
            });
            if (href && href.startsWith('http')) {
              await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
              clicked = true;
              console.log('[browser] click: href navigation');
            }
          } catch {}
        }

        if (!clicked) throw new Error(`Could not click: "${instruction}"`);

        const popup = await popupPromise;
        if (popup) {
          console.log('[browser] new tab — switching');
          currentPage = popup;
          await popup.waitForLoadState('domcontentloaded').catch(() => {});
          await popup.bringToFront().catch(() => {});
        }

        await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
        await page.waitForTimeout(2000);
        title = await page.title();
        finalUrl = page.url();
        break;
      }

      case 'add_to_cart': {
        await dismissOverlays(page);

        // Login wall?
        const cartCreds = await handleLoginWall(page, missionId, stepId);
        if (cartCreds) {
          await fillCredentials(page, cartCreds.username, cartCreds.password);
          for (let i = 0; i < 10; i++) {
            await page.waitForTimeout(1000);
            const wall = await detectLoginWall(page);
            if (!wall) break;
          }
          await dismissOverlays(page);
          await page.waitForTimeout(1000);
        }

        console.log('[browser] add_to_cart — looking for button');

        const variantSelectors = [
          'button:has-text("Select")',
          'a:has-text("Select")',
          'button:has-text("Choose")',
          'button:has-text("Continue")',
        ];
        for (const sel of variantSelectors) {
          const modal = await page.$(sel);
          if (modal && (await modal.isVisible().catch(() => false))) {
            await modal.click({ force: true }).catch(() => {});
            await page.waitForTimeout(1000);
            break;
          }
        }

        const cartSelectors = [
          '#add-to-cart-button',
          'input[name="submit.add-to-cart"]',
          'button[name="submit.add-to-cart"]',
          'button:has-text("Add to Cart")',
          'button:has-text("Add to cart")',
          'button:has-text("ADD TO CART")',
          'button:has-text("Add to Bag")',
          'button:has-text("Add to basket")',
          'button:has-text("Add to trolley")',
        ];

        let target: ElementHandle | null = null;
        for (const sel of cartSelectors) {
          try {
            const el = await page.waitForSelector(sel, { timeout: 3000, state: 'attached' });
            if (el) {
              await el.scrollIntoViewIfNeeded().catch(() => {});
              await page.waitForTimeout(300);
              if (await el.isVisible().catch(() => false)) {
                target = el;
                console.log(`[browser] add_to_cart: ${sel}`);
                break;
              }
            }
          } catch { continue; }
        }

        if (!target) {
          console.log('[browser] add_to_cart: rule-based finder failed — trying LLM');
          const { pickElementWithLLM } = await import('./browserElementFinder');
          const { handle } = await pickElementWithLLM(
            page,
            'the "Add to Cart" or "Add to Bag" or "Add to Basket" button on this product page'
          );
          if (handle) target = handle;
        }
        if (!target) throw new Error('Could not find Add to Cart button');

        const approved = await waitForSubmitApproval(missionId, stepId, 'Add to Cart', page.url());
        if (!approved) throw new Error('Rejected by user before Add to Cart');

        let clicked = false;
        try {
          await target.click({ timeout: 3000 });
          clicked = true;
          console.log('[browser] add_to_cart click: normal');
        } catch (e) {
          console.log(`[browser] add_to_cart: normal failed — ${(e as Error).message.slice(0, 80)}`);
        }

        if (!clicked) {
          try {
            await target.click({ force: true, timeout: 3000 });
            clicked = true;
            console.log('[browser] add_to_cart click: force');
          } catch (e) {
            console.log(`[browser] add_to_cart: force failed — ${(e as Error).message.slice(0, 80)}`);
          }
        }

        if (!clicked) {
          try {
            await target.evaluate((el: HTMLElement) => el.click());
            clicked = true;
            console.log('[browser] add_to_cart click: JS dispatch');
          } catch (e) {
            console.log(`[browser] add_to_cart: JS failed — ${(e as Error).message.slice(0, 80)}`);
          }
        }

        if (!clicked) {
          try {
            const clicked4 = await page.evaluate(() => {
              const btn =
                document.querySelector('#add-to-cart-button') ||
                document.querySelector('input[name="submit.add-to-cart"]') ||
                document.querySelector('button[name="submit.add-to-cart"]');
              if (btn) { (btn as HTMLElement).click(); return true; }
              return false;
            });
            clicked = clicked4;
            if (clicked4) console.log('[browser] add_to_cart click: native form');
          } catch {}
        }

        if (!clicked) throw new Error('Add to Cart button could not be clicked');

        await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
        await page.waitForTimeout(2000);
        await dismissOverlays(page);
        title = await page.title();
        finalUrl = page.url();
        break;
      }

      case 'buy': {
        await dismissOverlays(page);

        const buyCreds = await handleLoginWall(page, missionId, stepId);
        if (buyCreds) {
          await fillCredentials(page, buyCreds.username, buyCreds.password);
          for (let i = 0; i < 10; i++) {
            await page.waitForTimeout(1000);
            const wall = await detectLoginWall(page);
            if (!wall) break;
          }
          await dismissOverlays(page);
          await page.waitForTimeout(1000);
        }

        let target = await findByButtonText(page, [
          'buy now', 'buy it now', 'proceed to buy', 'proceed to checkout', 'place order', 'checkout',
        ]);
        if (!target) {
          console.log('[browser] buy: rule-based finder failed — trying LLM');
          const { pickElementWithLLM } = await import('./browserElementFinder');
          const { handle } = await pickElementWithLLM(
            page,
            'the "Buy Now" or "Proceed to Buy" or "Checkout" or "Place Order" button'
          );
          if (handle) target = handle;
        }
        if (!target) throw new Error('Could not find Buy / Checkout button');

        const approved = await waitForSubmitApproval(missionId, stepId, 'Buy / Checkout', page.url());
        if (!approved) throw new Error('Rejected by user before Buy');

        try {
          await target.click({ timeout: 3000 });
        } catch {
          await target.click({ force: true, timeout: 3000 }).catch(async () => {
            await target.evaluate((el: HTMLElement) => el.click());
          });
        }

        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(2500);
        title = await page.title();
        finalUrl = page.url();
        break;
      }

      case 'scroll': {
        const amount = Number(step.params.amount || 1);
        await page.evaluate((n: number) => window.scrollBy(0, n * window.innerHeight), amount);
        await page.waitForTimeout(1000);
        title = await page.title();
        finalUrl = page.url();
        break;
      }

      case 'back': {
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);
        title = await page.title();
        finalUrl = page.url();
        break;
      }

      case 'wait': {
        await page.waitForTimeout(Number(step.params.ms || 2000));
        title = await page.title();
        finalUrl = page.url();
        break;
      }

      case 'extract': {
        const text = await page.evaluate(() => document.body.innerText);
        title = await page.title();
        finalUrl = page.url();
        const shot = await snapshotBase64(page);
        earlyResult = {
          output: {
            url: finalUrl, title, action,
            extracted: text.slice(0, 3000),
            screenshotUrl: shot,
          },
          screenshot: shot,
          domSnapshot: await getDomSnapshot(page),
        };
        break;
      }

      default: {
        if (url) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        }
        title = await page.title();
        finalUrl = page.url();
      }
    }

    if (earlyResult) return earlyResult;

    const screenshotBase64 = await screenshotWithoutPausingVideo(page);
    console.log(`[browser] ✅ ${action} → "${title}" @ ${finalUrl}`);

    if (!HEADLESS) {
      await page.waitForTimeout(500);
    }

    return {
      output: {
        url: finalUrl,
        title,
        action,
        query,
        screenshotUrl: screenshotBase64,
        liveUrl: finalUrl,
      },
      screenshot: screenshotBase64,
      domSnapshot: await getDomSnapshot(page),
    };
  } catch (err) {
    console.error(`[browser] ❌ ${step.params.action} failed: ${(err as Error).message}`);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// Video helpers
// ─────────────────────────────────────────────────────────────
async function ensureVideoPlaying(page: Page) {
  try {
    const playBtn = await page.$('.ytp-play-button, button[aria-label*="play" i], button[title*="play" i]');
    if (playBtn) {
      try {
        const isPaused = await page.evaluate(() => {
          const v = document.querySelector('video') as HTMLVideoElement | null;
          return v ? v.paused : true;
        });
        if (isPaused) await playBtn.click({ timeout: 2000 }).catch(() => {});
      } catch {}
    }
    await page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement | null;
      if (v && v.paused) v.play().catch(() => {});
    });
  } catch {}
}

async function screenshotWithoutPausingVideo(page: Page): Promise<string> {
  try {
    const hasVideo = await page.evaluate(() => !!document.querySelector('video')).catch(() => false);
    const buf = await page.screenshot({ fullPage: false });
    const base64 = `data:image/png;base64,${buf.toString('base64')}`;
    if (hasVideo) {
      await page.waitForTimeout(150);
      await page.evaluate(() => {
        const v = document.querySelector('video') as HTMLVideoElement | null;
        if (v && v.paused) v.play().catch(() => {});
      }).catch(() => {});
      try {
        const isStillPaused = await page.evaluate(() => {
          const v = document.querySelector('video') as HTMLVideoElement | null;
          return v ? v.paused : false;
        });
        if (isStillPaused) await page.keyboard.press('k').catch(() => {});
      } catch {}
    }
    return base64;
  } catch { return ''; }
}

async function findNthVideo(page: Page, ordinal: number): Promise<ElementHandle | null> {
  const idx = Math.max(1, ordinal) - 1;
  const videoSelectors = [
    'a#video-title', 'ytd-video-renderer a#thumbnail', 'ytd-rich-item-renderer a#thumbnail',
    'ytd-compact-video-renderer a#thumbnail', 'div#search a h3', 'div.g a h3',
    'li.b_algo h2 a', 'a[href*="/video/"]', 'a[data-testid="video-card-link"]',
    'main article a[href]', 'main a[href]:not([href="#"])',
  ];
  const seen = new Set<string>();
  for (const sel of videoSelectors) {
    const candidates = await page.$$(sel);
    const visibleOnes: ElementHandle[] = [];
    for (const c of candidates) {
      if (!(await c.isVisible().catch(() => false))) continue;
      const key = await c.evaluate((el: any) => {
        const r = el.getBoundingClientRect();
        return `${Math.round(r.top)}:${Math.round(r.left)}:${el.tagName}`;
      });
      if (seen.has(key)) continue;
      seen.add(key);
      visibleOnes.push(c);
    }
    if (visibleOnes.length > idx) return visibleOnes[idx];
  }
  const fallback = await page.$$('main a[href]:not([href="#"])');
  const visibleFallback: ElementHandle[] = [];
  for (const f of fallback) {
    if (await f.isVisible().catch(() => false)) visibleFallback.push(f);
  }
  if (visibleFallback.length > idx) return visibleFallback[idx];
  return null;
}

// ─────────────────────────────────────────────────────────────
// Generic helpers
// ─────────────────────────────────────────────────────────────
async function getDomSnapshot(page: Page): Promise<string> {
  try { return (await page.content()).slice(0, 5000); } catch { return ''; }
}

async function clickFirstExternalResult(page: Page, engineUrl: string): Promise<boolean> {
  const engineHost = new URL(engineUrl).hostname.replace('www.', '');
  const resultSelectors = [
    'a[data-testid="result-title-a"]', 'article[data-testid="result"] h2 a',
    'article h2 a', 'div#search a h3', 'div#rso a h3', 'div.g a h3',
    'li.b_algo h2 a', 'main a[href^="http"]',
  ];
  for (const sel of resultSelectors) {
    const candidates = await page.$$(sel);
    for (const c of candidates) {
      if (!(await c.isVisible().catch(() => false))) continue;
      const anchor = await c.evaluateHandle((el: any) => el.closest('a') || el);
      const a = anchor.asElement() as ElementHandle<Element> | null;
      if (!a) continue;
      const href = await a.evaluate((el: any) => (el as HTMLAnchorElement).href || '');
      if (!href) continue;
      if (href.includes(engineHost) || /google\.|duckduckgo\.|bing\.|wikipedia\.org/i.test(href)) continue;

      console.log(`[browser] clicking result → ${href}`);
      await a.scrollIntoViewIfNeeded().catch(() => {});

      const popupPromise = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);
      await a.click({ timeout: 10_000 });
      const popup = await popupPromise;
      if (popup) {
        console.log('[browser] new tab — switching');
        currentPage = popup;
        await popup.waitForLoadState('domcontentloaded').catch(() => {});
        await popup.bringToFront().catch(() => {});
      }
      return true;
    }
  }
  return false;
}

async function findSearchInput(page: Page): Promise<ElementHandle | null> {
  const selectors = [
    'textarea[name="q"]', 'input[name="q"]', 'input[type="search"]',
    'input[role="searchbox"]', 'input[role="combobox"]',
    'input[name="query"]', 'input[name="search"]', 'input[name="search_query"]',
    'input[name="keyword"]', 'input[name="keywords"]', 'input[name="field-keywords"]',
    'input[name="searchTerm"]', 'input[name="k"]', 'input[id*="search" i]',
    'input[aria-label*="search" i]', 'input[placeholder*="search" i]',
    'input[title*="search" i]', 'input[type="text"][name*="search" i]',
    'textarea[aria-label*="search" i]', 'textarea[placeholder*="search" i]',
    'form[role="search"] input', 'form[role="search"] textarea',
    '[role="search"] input', '[role="search"] textarea',
  ];
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el && (await el.isVisible().catch(() => false))) return el;
  }
  const best = await page.evaluateHandle(() => {
    const visible = (el: any) => {
      const r = el.getBoundingClientRect();
      return r.width > 80 && r.height > 15;
    };
    const inputs = Array.from(document.querySelectorAll(
      'input[type="text"], input:not([type]), input[type="search"], textarea'
    )).filter(visible) as any[];
    let bestScore = -1;
    let bestEl: any = null;
    for (const el of inputs) {
      let score = 0;
      const hint = `${el.name || ''} ${el.id || ''} ${el.placeholder || ''} ${el.getAttribute?.('aria-label') || ''} ${el.className || ''}`.toLowerCase();
      if (hint.includes('search')) score += 10;
      if (hint.includes('query')) score += 8;
      if (hint.includes('find')) score += 6;
      if (hint.includes('keyword')) score += 6;
      const r = el.getBoundingClientRect();
      if (r.width > 250) score += 3;
      if (r.top < 250) score += 2;
      if (el.form) score += 1;
      if (score > bestScore) { bestScore = score; bestEl = el; }
    }
    return bestEl;
  });
  return best.asElement() as ElementHandle<Element> | null;
}

async function findClickable(page: Page, instruction: string): Promise<ElementHandle | null> {
  const lower = instruction.toLowerCase();
  if (/first|top|#1/.test(lower) && /result|product|item|video|link|listing/.test(lower)) {
    const amazonSpecific = [
      'div[data-component-type="s-search-result"]:not([data-component-type="sp-sponsored-result"]) h2 a',
      'div.s-main-slot div[data-asin]:not([data-asin=""]):not(.AdHolder) h2 a',
      'div.s-main-slot h2 a.a-link-normal',
    ];
    for (const sel of amazonSpecific) {
      const els = await page.$$(sel);
      for (const el of els) {
        if (await el.isVisible().catch(() => false)) return el;
      }
    }
    const firstResultSelectors = [
      'main a[href]:not([href="#"])', 'main article a', '[role="main"] a[href]',
      '#content a[href]', '#main a[href]',
      'div[data-component-type="s-search-result"] h2 a', 'div.s-main-slot a.a-link-normal',
      'div._1AtVbE a._2rpwqI', 'a.IRpwTa', 'a.CGtC98',
      'a#video-title', 'ytd-video-renderer a#thumbnail', 'ytd-rich-item-renderer a#thumbnail',
      'div#search a h3', 'div.g a', 'li.s-item a.s-item__link',
      'div[data-testid="list-view"] a', 'ol a', 'ul li a[href]', 'article a[href]',
    ];
    for (const sel of firstResultSelectors) {
      const el = await page.$(sel);
      if (el && (await el.isVisible().catch(() => false))) return el;
    }
    const fallback = await page.$('a[href]:not(nav a):not(header a):not([href="#"])');
    if (fallback) return fallback;
  }
  if (/log\s*in|sign\s*in/.test(lower)) {
    return findByButtonText(page, ['log in', 'login', 'sign in', 'signin']);
  }
  const textMatch = instruction.match(/(?:the\s+)?["']?([^"']+?)["']?\s*(?:button|link|item|result)?$/i);
  if (textMatch) {
    const text = textMatch[1].replace(/\b(button|link|item|result)\b/gi, '').trim();
    const el = await findByButtonText(page, [text]);
    if (el) return el;
  }
  return null;
}

async function findByButtonText(page: Page, texts: string[]): Promise<ElementHandle | null> {
  const handle = await page.evaluateHandle((search: string[]) => {
    const visible = (el: any) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const candidates = Array.from(document.querySelectorAll(
      'button, a, [role="button"], input[type="submit"], input[type="button"]'
    )).filter(visible) as any[];
    const needles = search.map((s) => s.toLowerCase());
    for (const el of candidates) {
      const label = (el.innerText || el.value || el.getAttribute?.('aria-label') || el.getAttribute?.('title') || '').trim().toLowerCase();
      for (const n of needles) {
        if (label.includes(n)) return el;
      }
    }
    return null;
  }, texts);
  return handle.asElement() as ElementHandle<Element> | null;
}

async function findInputByLabel(page: Page, label: string): Promise<ElementHandle | null> {
  const l = label.toLowerCase();
  const selectors = [
    `input[name="${l}"]`, `input[id="${l}"]`, `input[name*="${l}" i]`,
    `input[id*="${l}" i]`, `input[placeholder*="${l}" i]`,
    `input[aria-label*="${l}" i]`, `input[autocomplete="${l}"]`,
  ];
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el && (await el.isVisible().catch(() => false))) return el;
  }
  if (l.includes('email')) return page.$('input[type="email"]');
  if (l.includes('password')) return page.$('input[type="password"]');
  if (l.includes('phone') || l.includes('mobile')) return page.$('input[type="tel"]');
  if (l.includes('user')) return page.$('input[type="text"]');
  return null;
}

async function findLoginUsernameField(page: Page): Promise<ElementHandle | null> {
  const selectors = [
    'input[type="email"]', 'input[name="email"]', 'input[name="username"]',
    'input[name="login"]', 'input[name="identifier"]',
    'input[autocomplete="username"]', 'input[autocomplete="email"]',
    'input[aria-label*="email" i]', 'input[aria-label*="username" i]',
    'input[aria-label*="phone" i]', 'input[placeholder*="email" i]',
    'input[placeholder*="username" i]', 'input[placeholder*="phone" i]',
    'input[type="text"]', 'input[type="tel"]',
  ];
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el && (await el.isVisible().catch(() => false))) return el;
  }
  return null;
}

async function submitForm(page: Page) {
  const submitSelectors = [
    'button[type="submit"]', 'input[type="submit"]',
    'button:has-text("Continue")', 'button:has-text("Next")',
    'button:has-text("Sign in")', 'button:has-text("Log in")',
    'button:has-text("Log In")', 'button:has-text("Sign up")',
    'button:has-text("Register")', 'button:has-text("Create")',
    'button:has-text("Submit")',
  ];
  for (const sel of submitSelectors) {
    const btn = await page.$(sel);
    if (btn && (await btn.isVisible().catch(() => false))) {
      await btn.click().catch(() => {});
      return;
    }
  }
  await page.keyboard.press('Enter');
}

async function submitSearch(page: Page, field: ElementHandle) {
  const handle = await page.evaluateHandle((input: any) => {
    const form = input.closest('form');
    if (!form) return null;
    return form.querySelector('button[type="submit"], input[type="submit"], button[aria-label*="search" i]');
  }, field);
  const btn = handle.asElement() as ElementHandle<Element> | null;
  if (btn) {
    await btn.click({ force: true }).catch(async () => { await field.press('Enter'); });
  } else {
    await field.press('Enter');
  }
}

async function snapshotBase64(page: Page): Promise<string> {
  try {
    const buf = await page.screenshot({ fullPage: false });
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch { return ''; }
}

async function dismissOverlays(page: Page) {
  const selectors = [
    'button#L2AGLb', 'button[aria-label*="Accept" i]', 'button[aria-label*="Agree" i]',
    'button:has-text("Accept all")', 'button:has-text("Accept All")',
    'button:has-text("I agree")', 'button:has-text("Agree")',
    'div[role="none"] button:has-text("Accept")',
    'button:has-text("Allow all cookies")', 'button:has-text("Only allow essential")',
    'button:has-text("Got it")', 'button:has-text("Not Now")',
    'button:has-text("Not now")', 'div[role="button"]:has-text("Not Now")',
    'button[aria-label*="Close" i]', 'button[aria-label*="Dismiss" i]',
  ];
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && (await el.isVisible().catch(() => false))) {
        await el.click().catch(() => {});
        await page.waitForTimeout(600);
      }
    } catch {}
  }
  await page.waitForTimeout(300);
}

async function detectCaptcha(page: Page): Promise<{ present: boolean; kind: string }> {
  const url = page.url().toLowerCase();
  const urlPatterns: Array<[RegExp, string]> = [
    [/\/auth_platform\/recaptcha/, 'Instagram reCAPTCHA'],
    [/\/challenge\//, 'Challenge page'],
    [/\/captcha/, 'Captcha URL'],
    [/recaptcha/i, 'reCAPTCHA URL'],
    [/hcaptcha/i, 'hCaptcha URL'],
    [/cf-challenge|cdn-cgi\/challenge/i, 'Cloudflare challenge'],
    [/\/sorry\//, 'Google "unusual traffic"'],
    [/accounts\.google\.com\/signin\/v2\/challenge/, 'Google challenge'],
  ];
  for (const [re, kind] of urlPatterns) {
    if (re.test(url)) return { present: true, kind };
  }
  const elementChecks: Array<[string, string]> = [
    ['iframe[src*="recaptcha"]', 'reCAPTCHA'], ['iframe[src*="hcaptcha"]', 'hCaptcha'],
    ['iframe[src*="turnstile"]', 'Cloudflare Turnstile'],
    ['iframe[src*="challenges.cloudflare.com"]', 'Cloudflare challenge'],
    ['div.g-recaptcha', 'reCAPTCHA'], ['div.h-captcha', 'hCaptcha'],
    ['div[class*="captcha" i]', 'Captcha'], ['img[src*="captcha" i]', 'Image captcha'],
    ['input[name*="captcha" i]', 'Captcha input'], ['[id*="captcha" i]', 'Captcha container'],
    ['div#challenge-stage', 'Cloudflare challenge'],
    ['form[action*="challenge" i]', 'Challenge form'],
    ['div[data-testid*="captcha" i]', 'Test-id captcha'],
    ['[class*="Captcha" i]', 'Captcha (class)'],
    ['[data-testid*="captcha" i]', 'Captcha (testid)'],
  ];
  for (const [sel, kind] of elementChecks) {
    const el = await page.$(sel).catch(() => null);
    if (el && (await el.isVisible().catch(() => false))) return { present: true, kind };
  }
  const text = (await page.evaluate(() => document.body.innerText).catch(() => '')).toLowerCase();
  const phrases = [
    "i'm not a robot", 'i am not a robot', 'verify you are human',
    'verify that you are human', 'are you a robot', 'unusual traffic',
    'security check', 'please confirm you are not a robot',
    'complete the security check', 'help us combat harmful conduct',
    'recaptcha enterprise', 'recaptcha', 'hcaptcha',
  ];
  for (const p of phrases) {
    if (text.includes(p)) return { present: true, kind: 'Captcha (text)' };
  }
  return { present: false, kind: '' };
}