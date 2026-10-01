import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-accent flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-accent" />
            </div>
            <span className="font-semibold tracking-wider">ENVOY</span>
          </div>
          <nav className="flex gap-6 text-sm text-muted">
            <Link href="/dashboard" className="hover:text-white transition">Dashboard</Link>
            <a
              href="https://github.com"
              className="hover:text-white transition"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <section className="flex-1 flex items-center">
        <div className="max-w-4xl mx-auto px-6 py-24 text-center">
          <div className="inline-block px-3 py-1 mb-6 text-xs tracking-widest uppercase text-accent border border-accent-dim rounded-full">
            PS-01 · Autonomous Agents
          </div>
          <h1 className="text-5xl md:text-7xl font-semibold leading-tight mb-6">
            The autonomous AI operator that <span className="text-accent">exits the chat</span> and drives your apps.
          </h1>
          <p className="text-lg text-muted max-w-2xl mx-auto mb-10">
            ENVOY takes a spoken or typed command and runs the entire workflow across your everyday apps — via browser automation, MCP, and APIs. Verifies in real time. Recovers from errors. Pauses for your sign-off before anything irreversible.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-6 py-3 bg-accent text-black font-medium rounded-lg hover:bg-yellow-400 transition"
          >
            Launch Console →
          </Link>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-20 text-left">
            {[
              ['>95%', 'Verification accuracy'],
              ['>80%', 'Auto-recovery rate'],
              ['≤5 min', 'Task execution'],
              ['100%', 'Audit trail'],
            ].map(([k, v]) => (
              <div key={k} className="border border-border rounded-lg p-5">
                <div className="text-2xl font-semibold text-accent">{k}</div>
                <div className="text-xs text-muted mt-1 uppercase tracking-wider">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-6 text-xs text-muted flex items-center justify-between">
          <span>CogniVerse · BFWAI/HACK 26</span>
          <span>Rohit Sawant · Aryan Sapkal · Soham Raul</span>
        </div>
      </footer>
    </main>
  );
}