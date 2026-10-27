import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MIKE — Personal AI Assistant',
  description:
    'MIKE is your hyper-organized executive personal AI assistant: chat, function calling, calendar tools, and Postgres storage.',
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
