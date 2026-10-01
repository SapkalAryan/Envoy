import OpenAI from 'openai';

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.warn('[llm] OPENAI_API_KEY not set — running in mock mode');
}

export const llm = apiKey
  ? new OpenAI({ apiKey })
  : null;

export const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

export async function chatJSON<T>(system: string, user: string): Promise<T> {
  if (!llm) {
    throw new Error('LLM not configured');
  }
  const res = await llm.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });
  const content = res.choices[0]?.message?.content || '{}';
  return JSON.parse(content) as T;
}

export async function chatText(system: string, user: string): Promise<string> {
  if (!llm) throw new Error('LLM not configured');
  const res = await llm.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.3,
  });
  return res.choices[0]?.message?.content || '';
}