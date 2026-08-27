import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PlanProvider } from "@/presentation/features/access/plan-provider";
import { preferencesScript } from "@/shared/lib/ui-preferences";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const TITLE = "Coin Secret — Crypto Technical Analysis";
const DESCRIPTION =
  "Rule-based crypto chart analysis, supply-demand detection, and market scanning.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  // Without a card image a shared link renders as a bare grey box, which is
  // the first thing anyone sees of the product and says nothing about it.
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Coin Secret" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The preference script rewrites these attributes before React hydrates, so
    // the server markup is expected to differ from what the browser holds.
    <html
      lang="id"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Runs before the first paint. Restoring the theme afterwards would
            show the default one first, and a page that flashes white on a dark
            theme is the most visible bug a theme toggle can have. */}
        <script dangerouslySetInnerHTML={{ __html: preferencesScript() }} />
      </head>
      <body className="h-full">
        <PlanProvider>{children}</PlanProvider>
      </body>
    </html>
  );
}
