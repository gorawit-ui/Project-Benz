import type { Metadata } from "next";
import type { ReactNode } from "react";
import SessionProviderWrapper from "@/components/SessionProviderWrapper";
import NavBar from "@/components/NavBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "TDFB Expense Tracking",
  description: "ระบบบันทึกและติดตามค่าใช้จ่าย TDFB",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" className="h-full">
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        <SessionProviderWrapper>
          <NavBar />
          <main className="flex-1">{children}</main>
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
