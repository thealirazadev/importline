import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "importline",
  description: "Resumable bulk CSV import engine for product catalogs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="border-b border-border bg-surface">
          <div className="mx-auto flex max-w-content items-center gap-6 px-6 py-3">
            <Link href="/imports" className="font-semibold">
              importline
            </Link>
            <Link href="/imports" className="text-muted hover:text-text">
              Imports
            </Link>
          </div>
        </nav>
        <main className="mx-auto max-w-content px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
