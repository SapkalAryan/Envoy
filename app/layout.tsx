import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ENVOY — Autonomous AI Operator',
  description: 'The autonomous AI operator that exits the chat and drives your apps.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-white antialiased">{children}</body>
    </html>
  );
}