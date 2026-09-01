import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Prompt } from "next/font/google";
import SessionProviderWrapper from "@/components/SessionProviderWrapper";
import NavBar from "@/components/NavBar";
import ReportBugButton from "@/components/ReportBugButton";
import "./globals.css";

// Prompt renders Thai cleanly at every weight and is self-hosted by Next.js
// at build time (no runtime dependency on an external font CDN). Same
// typeface used in the Landing/Login design mockup for consistency.
const prompt = Prompt({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const APP_NAME = "TDFB Expense Tracking";
const APP_DESCRIPTION = "ระบบบันทึกและติดตามค่าใช้จ่าย TDFB";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
  // Lets iOS run the app full-screen once added to the home screen; Android
  // takes this from the manifest's display/theme_color instead.
  appleWebApp: { capable: true, title: "TDFB Expense", statusBarStyle: "black-translucent" },
  // Composited once as a static PNG (public/og-image.png) rather than
  // generated per-request: the card is the same for every page, so a static
  // file is simpler than an edge function and needs no font-fetching at
  // request time. Regenerate with `python3 scripts/generate-og-image.py`.
  openGraph: {
    title: APP_NAME,
    description: APP_DESCRIPTION,
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: APP_NAME }],
    locale: "th_TH",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: APP_NAME,
    description: APP_DESCRIPTION,
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#065f46", // tints the mobile browser chrome to the brand colour
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" className="h-full">
      <body className={`${prompt.className} min-h-full flex flex-col bg-zinc-50 text-zinc-900`}>
        <SessionProviderWrapper>
          <NavBar />
          <main className="flex-1 pb-20 sm:pb-0">{children}</main>
          <ReportBugButton />
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
