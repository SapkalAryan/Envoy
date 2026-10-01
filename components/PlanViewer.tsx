'use client';

import { useState } from 'react';
import type { MissionPlan } from '@/lib/types';
import { StatusBadge } from './StatusBadge';

const TOOL_LABEL: Record<string, string> = {
  api: 'API',
  browser: 'Browser',
  mcp: 'MCP',
  llm: 'LLM',
  human: 'Human',
};

export function PlanViewer({ plan }: { plan: MissionPlan | null }) {
  const [lightbox, setLightbox] = useState<string | null>(null);

  if (!plan) return null;

  return (
    <>
      <div className="border border-border rounded-xl bg-surface overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-xs text-muted uppercase tracking-wider">Mission Plan</div>
            <div className="text-sm mt-1">{plan.summary}</div>
          </div>
          <div className="text-xs text-muted font-mono">{plan.id}</div>
        </div>

        <ol className="divide-y divide-border">
          {plan.steps.map((step, i) => {
            const rawScreenshot =
              step.result?.screenshot ??
              (step.result?.output as Record<string, unknown> | undefined)?.screenshotUrl;

            const screenshot: string | null =
              typeof rawScreenshot === 'string' && rawScreenshot.length > 0
                ? rawScreenshot
                : null;

            return (
              <li key={step.id} className="px-5 py-4 flex items-start gap-4">
                <div className="w-7 h-7 rounded-full border border-border flex items-center justify-center text-xs text-muted shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm">{step.description}</span>
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 border border-border rounded text-muted">
                      {TOOL_LABEL[step.tool] || step.tool}
                    </span>
                    {step.requiresApproval && (
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 border border-warning/40 text-warning rounded">
                        Approval
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted mt-1 font-mono truncate">
                    → {step.target}
                  </div>

                  {step.error && (
                    <div className="mt-2 text-xs text-danger border border-danger/40 bg-danger/10 rounded p-2">
                      {step.error}
                    </div>
                  )}

                  {screenshot && (
                    <button
                      type="button"
                      onClick={() => setLightbox(screenshot)}
                      className="mt-3 block w-full border border-border rounded-lg overflow-hidden hover:border-accent transition group"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={screenshot}
                        alt={`Step ${i + 1} screenshot`}
                        className="w-full h-auto group-hover:opacity-90 transition"
                      />
                      <div className="text-[10px] text-muted text-center py-1 bg-bg/50">
                        Click to expand
                      </div>
                    </button>
                  )}
                </div>
                <StatusBadge status={step.status} />
              </li>
            );
          })}
        </ol>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="Step screenshot (expanded)"
            className="max-w-full max-h-full rounded-lg border border-border"
          />
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 text-white text-2xl leading-none px-3 py-1 rounded hover:bg-white/10"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}