'use client';

import { useState } from 'react';

export function CommandInput({
  onSubmit,
  loading,
}: {
  onSubmit: (prompt: string) => void;
  loading: boolean;
}) {
  const [value, setValue] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || loading) return;
    onSubmit(value.trim());
  }

  const samples = [
    'Update the CRM with this lead, log it in Sheets, and prepare a follow-up email.',
    'Pull yesterday\'s orders from the portal and append to the dashboard sheet.',
    'Onboard the new vendor: create account, upload docs, notify finance.',
  ];

  return (
    <div className="border border-border rounded-xl p-5 bg-surface">
      <form onSubmit={submit} className="space-y-3">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Describe your goal in one sentence…"
          rows={3}
          className="w-full bg-bg border border-border rounded-lg p-4 text-sm resize-none focus:outline-none focus:border-accent transition"
        />
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            {samples.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setValue(s)}
                className="text-xs px-3 py-1.5 border border-border rounded-full text-muted hover:text-white hover:border-accent transition"
              >
                {s.slice(0, 42)}…
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={loading || !value.trim()}
            className="px-5 py-2.5 bg-accent text-black font-medium rounded-lg hover:bg-yellow-400 disabled:opacity-40 transition whitespace-nowrap"
          >
            {loading ? 'Running…' : 'Run Mission'}
          </button>
        </div>
      </form>
    </div>
  );
}