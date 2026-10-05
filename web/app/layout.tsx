import type { Metadata, Viewport } from "next";
import { Literata } from "next/font/google";
import "./globals.css";

// Reading serif, self-hosted by next/font; globals.css exposes it as `font-serif` / var(--font-serif).
const literata = Literata({ subsets: ["latin"], display: "swap", variable: "--font-literata" });

export const metadata: Metadata = { title: "Chapterly", robots: { index: false, follow: false } };
export const viewport: Viewport = {
  width: "device-width", initialScale: 1,
  themeColor: [   // = --page in globals.css
    { media: "(prefers-color-scheme: light)", color: "#faf7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1916" },
  ],
};
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${literata.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
