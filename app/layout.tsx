import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex", display: "swap" });

export const metadata: Metadata = {
  title: "FeasiServe — after-sales serviceability investigations",
  description: "Find out whether a product can actually be serviced where you live, before you buy it.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={plex.variable}>
      <body className="min-h-screen bg-ground font-sans text-ink antialiased">
        <header className="bg-panel">
          <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
              {/* mark: a locator pin cut into a square, the product's one shape */}
              <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
                <rect width="22" height="22" rx="4" fill="var(--color-accent)" />
                <path d="M11 4.5a4.5 4.5 0 0 0-4.5 4.5c0 3.2 4.5 8.5 4.5 8.5s4.5-5.3 4.5-8.5A4.5 4.5 0 0 0 11 4.5Zm0 6.3a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6Z" fill="var(--color-accent-ink)" />
              </svg>
              FeasiServe
            </Link>
            <Link href="/" className="rounded-md px-3 py-1.5 text-sm text-soft transition-colors hover:bg-raised hover:text-ink">
              New investigation
            </Link>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
