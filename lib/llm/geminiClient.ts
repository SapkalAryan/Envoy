// lib/llm/geminiClient.ts
import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

if (!apiKey) {
  console.warn('[gemini] GEMINI_API_KEY not set — LLM features disabled');
}

const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export async function geminiChat(
  system: string,
  user: string,
  options?: { jsonMode?: boolean; temperature?: number; maxTokens?: number }
): Promise<string> {
  if (!ai) throw new Error('GEMINI_API_KEY not set');

  const MAX_RETRIES = 4;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: user,
        config: {
          systemInstruction: system,
          temperature: options?.temperature ?? 0.2,
          maxOutputTokens: options?.maxTokens ?? 2048,
          ...(options?.jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
      });

      const text = response.text;
      if (!text) throw new Error('Gemini returned empty response');
      return text;
    } catch (err) {
      lastError = err as Error;
      const msg = lastError.message || '';

      const retryable =
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('high demand') ||
        msg.includes('429') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('overloaded');

      if (!retryable || attempt === MAX_RETRIES - 1) throw lastError;

      const delay = Math.pow(2, attempt) * 1000;
      console.log(
        `[gemini] attempt ${attempt + 1} failed (${msg.slice(0, 60)}...) — retrying in ${delay}ms`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError || new Error('Gemini failed after retries');
}

export async function geminiJSON<T>(
  system: string,
  user: string,
  options?: { temperature?: number; maxTokens?: number }
): Promise<T | null> {
  try {
    const raw = await geminiChat(system, user, { ...options, jsonMode: true });
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    return JSON.parse(cleaned) as T;
  } catch (err) {
    console.error('[gemini] JSON parse failed:', (err as Error).message);
    return null;
  }
}

export function isGeminiAvailable(): boolean {
  return !!ai;
}