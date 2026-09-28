import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Novels", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
