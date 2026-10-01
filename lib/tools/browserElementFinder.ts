// lib/tools/browserElementFinder.ts
import type { Page, ElementHandle } from 'playwright';
import { geminiJSON, isGeminiAvailable } from '../llm/geminiClient';

async function snapshotInteractive(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const out: string[] = [];
    out.push(`URL: ${location.href}`);
    out.push(`TITLE: ${document.title}`);

    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    const els = Array.from(
      document.querySelectorAll(
        'a, button, input, select, textarea, [role="button"], [role="link"], [role="search"], [contenteditable="true"]'
      )
    )
      .filter(visible)
      .slice(0, 100);

    out.push(`\nINTERACTIVE ELEMENTS (${els.length}):`);
    els.forEach((el, i) => {
      const tag = el.tagName.toLowerCase();
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      const aria = el.getAttribute('aria-label') || '';
      const ph = el.getAttribute('placeholder') || '';
      const name = el.getAttribute('name') || '';
      const id = el.getAttribute('id') || '';
      const href = el.getAttribute('href') || '';
      const type = el.getAttribute('type') || '';

      const parts = [`#${i}`, `<${tag}`];
      if (type) parts.push(`type=${type}`);
      if (id) parts.push(`id="${id.slice(0, 25)}"`);
      if (name) parts.push(`name="${name.slice(0, 25)}"`);
      if (ph) parts.push(`placeholder="${ph.slice(0, 30)}"`);
      if (aria) parts.push(`aria="${aria.slice(0, 30)}"`);
      if (href && tag === 'a') parts.push(`href="${href.slice(0, 50)}"`);
      parts.push('>');
      if (text) parts.push(text);

      out.push(parts.join(' '));
    });

    return out.join('\n');
  });
}

interface ElementPick {
  matchIndex: number;
  confidence: number;
  reason: string;
}

const SYSTEM_PROMPT = `You are a browser agent. Given a page snapshot and instruction, pick the best interactive element. Reply with JSON only.

Return JSON:
{
  "matchIndex": <number from the #N list, or -1>,
  "confidence": 0.0-1.0,
  "reason": "short explanation"
}

Rules:
- "first result/product/video/link" → first anchor in main content, NOT nav/header/logo.
- "search box" → prominent text input.
- "add to cart / buy" → matching button.
- "log in / sign in" → matching button or link.
- "email/username/password field" → matching input.
- If nothing matches, matchIndex: -1.`;

export async function pickElementWithLLM(
  page: Page,
  instruction: string
): Promise<{ handle: ElementHandle | null; pick: ElementPick | null }> {
  if (!isGeminiAvailable()) return { handle: null, pick: null };

  try {
    const snap = await snapshotInteractive(page);

    const pick = await geminiJSON<ElementPick>(
      SYSTEM_PROMPT,
      `PAGE SNAPSHOT:\n${snap}\n\nINSTRUCTION: "${instruction}"`,
      { temperature: 0.1, maxTokens: 300 }
    );

    if (!pick || pick.matchIndex < 0) {
      console.log(`[llm-finder] no match: ${pick?.reason || 'unknown'}`);
      return { handle: null, pick };
    }

    console.log(
      `[llm-finder] picked #${pick.matchIndex} (${Math.round((pick.confidence || 0) * 100)}%): ${pick.reason}`
    );

    const handle = await page.evaluateHandle((idx: number) => {
      const visible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const els = Array.from(
        document.querySelectorAll(
          'a, button, input, select, textarea, [role="button"], [role="link"], [role="search"], [contenteditable="true"]'
        )
      ).filter(visible);
      return els[idx] || null;
    }, pick.matchIndex);

    return { handle: handle.asElement() as ElementHandle | null, pick };
  } catch (err) {
    console.error('[llm-finder] error:', (err as Error).message);
    return { handle: null, pick: null };
  }
}