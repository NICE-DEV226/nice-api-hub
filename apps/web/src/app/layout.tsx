/**
 * Root Layout
 * Author: NICE-DEV
 */

import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: "NICE-API'HUB - Universal Media Downloader API",
  description: 'Professional API platform for downloading media from 20+ social platforms. Built by NICE-DEV.',
  keywords: ['API', 'media downloader', 'TikTok', 'YouTube', 'Instagram', 'developer tools'],
  icons: {
    icon: '/favicon.png',
    shortcut: '/favicon.png',
    apple: '/favicon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.png" type="image/png" />
      </head>
      <body className={`${inter.className} bg-neutral-50 text-neutral-900`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
