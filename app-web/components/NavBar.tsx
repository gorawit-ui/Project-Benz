"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";

const LINKS = [
  { href: "/", label: "บันทึกค่าใช้จ่าย" },
  { href: "/review", label: "ตรวจทาน" },
  { href: "/dashboard", label: "แดชบอร์ด" },
  { href: "/receipt-doc/create", label: "สร้างเอกสารรับเงิน" },
];

export default function NavBar() {
  const { data: session } = useSession();
  const pathname = usePathname();

  // Live clock in the header corner. Starts as null (not "new Date()") so
  // the server-rendered markup and the first client render match — filling
  // it in immediately after mount, then ticking every 30s, is plenty for a
  // glance-at-the-corner clock and avoids a hydration mismatch warning.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // Setting state synchronously here is intentional, not an anti-pattern
    // to refactor away: the server can't know the client's clock, so it
    // renders `now` as null, and this effect fills in the real value right
    // after mount — the standard way to avoid a hydration mismatch on a
    // client-only value like the current time.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // The jwt callback (lib/auth.ts) tries to silently refresh an expired
  // Google access token; this only fires if that refresh itself failed
  // (e.g. the refresh_token was revoked) — the session is carrying a dead
  // accessToken at that point, so every Sheets/Drive call would keep
  // failing until the user re-authorizes. Kick off a fresh Google sign-in
  // automatically rather than leaving that to show up as a confusing error
  // partway through some unrelated action.
  useEffect(() => {
    if (session?.error === "RefreshAccessTokenError") {
      void signIn("google");
    }
  }, [session?.error]);

  if (!session) return null;

  return (
    <header className="border-b border-zinc-200 bg-white">
      {/* Split into rows (brand+clock / nav links / user+logout) rather than
          one big flex-wrap of everything — on a phone, wrapping was mixing
          nav links in with the brand and team badge with no clear grouping.
          Each row still wraps on its own if it has to. */}
      <div className="mx-auto max-w-4xl px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 font-semibold text-emerald-800">TDFB Expense</span>
            {session.team && (
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                {session.team.name}
              </span>
            )}
          </div>
          {now && (
            <span className="text-xs text-zinc-400">
              {greetingFor(now)} · {now.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-2">
          <div className="flex flex-wrap items-center gap-1">
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
            <span className="max-w-[9rem] truncate sm:max-w-none">{session.user?.name ?? session.user?.email}</span>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex-shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 transition-all duration-150 hover:bg-zinc-100 active:scale-95 active:bg-zinc-200"
            >
              ออกจากระบบ
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

/** Greets by time of day — the clock was already here, so this is free warmth. */
function greetingFor(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "สวัสดีตอนเช้า ☀️";
  if (hour < 17) return "สวัสดีตอนบ่าย 🌤️";
  return "สวัสดีตอนเย็น 🌙";
}
