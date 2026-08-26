import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "TDFB Expense Tracking",
  description: "ระบบบันทึกและติดตามค่าใช้จ่าย TDFB",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" className="h-full">
      <body className={`${prompt.className} min-h-full flex flex-col bg-zinc-50 text-zinc-900`}>
        <SessionProviderWrapper>
          <NavBar />
          <main className="flex-1">{children}</main>
          <ReportBugButton />
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
