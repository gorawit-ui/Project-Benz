"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

const LINKS = [
  { href: "/", label: "บันทึกค่าใช้จ่าย" },
  { href: "/review", label: "ตรวจทาน" },
  { href: "/dashboard", label: "แดชบอร์ด" },
  { href: "/receipt-doc/create", label: "สร้างเอกสารรับเงิน" },
];

export default function NavBar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  if (!session) return null;

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 font-semibold text-emerald-800">TDFB Expense</span>
          {session.team && (
            <span className="mr-2 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              {session.team.name}
            </span>
          )}
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-150 active:scale-95 ${
                  active
                    ? "bg-emerald-100 text-emerald-800"
                    : "text-zinc-600 hover:bg-emerald-50 hover:text-emerald-800 active:bg-emerald-100"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-3 text-sm text-zinc-600">
          <span>{session.user?.name ?? session.user?.email}</span>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 transition-all duration-150 hover:bg-zinc-100 active:scale-95 active:bg-zinc-200"
          >
            ออกจากระบบ
          </button>
        </div>
      </div>
    </header>
  );
}
