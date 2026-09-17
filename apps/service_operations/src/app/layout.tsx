import type { Metadata } from 'next';
import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Service Job Cards',
  description: 'Offline-first service job card management'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link className="brand" href="/">
            <span className="brandMark"><ClipboardList size={20} /></span>
            <span><b>ServiceFlow</b><small>Job Cards</small></span>
          </Link>
        </header>
        <main className="pageShell">{children}</main>
      </body>
    </html>
  );
}
