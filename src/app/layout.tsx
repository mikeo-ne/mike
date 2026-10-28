import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '1ne — Music Workspace & AI Assistant',
  description:
    '1ne is your music workspace and AI assistant: projects, releases, an AI team (A&R, marketing, legal, mix), calendar, tasks, and memory.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 font-sans text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
