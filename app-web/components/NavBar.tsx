"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";
import { ActionButton, NavIcon } from "./ui";

const LINKS = [
  { href: "/", label: "บันทึกค่าใช้จ่าย", shortLabel: "บันทึก", icon: "plus" },
  { href: "/review", label: "ตรวจทาน", shortLabel: "ตรวจทาน", icon: "check" },
  { href: "/dashboard", label: "แดชบอร์ด", shortLabel: "ภาพรวม", icon: "chart" },
  { href: "/receipt-doc/create", label: "สร้างเอกสารรับเงิน", shortLabel: "เอกสาร", icon: "file" },
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
    <>
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-white/95 backdrop-blur">
      {/* Split into rows (brand+clock / nav links / user+logout) rather than
          one big flex-wrap of everything — on a phone, wrapping was mixing
          nav links in with the brand and team badge with no clear grouping.
          Each row still wraps on its own if it has to. */}
      <div className="mx-auto max-w-4xl px-4 py-2.5 sm:px-6 sm:py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 font-bold tracking-tight text-[var(--brand-strong)]">TDFB Expense</span>
            {session.team && (
              <span className="rounded-full bg-[var(--brand-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--brand)]">
                {session.team.name}
              </span>
            )}
          </div>
          {now && (
            <span className="hidden text-xs text-[var(--muted)] sm:inline">
              {greetingFor(now)} · {now.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}
            </span>
          )}
        </div>

        <div className="mt-2 flex items-center justify-end gap-3 border-t border-[var(--line)] pt-2 sm:justify-start">
          <div className="hidden min-w-0 flex-1 overflow-hidden sm:block">
            <nav
              aria-label="เมนูหลัก"
              className="flex w-full gap-1 overflow-x-auto pb-0.5 pr-3 [scrollbar-width:none]"
            >
              {LINKS.map((link) => {
                const active = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 active:scale-95 ${
                      active
                        ? "bg-[var(--brand-soft)] text-[var(--brand-strong)]"
                        : "text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--ink)]"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-sm text-[var(--muted)]">
            <span className="hidden max-w-[9rem] truncate md:inline">{session.user?.name ?? session.user?.email}</span>
            <ActionButton
              variant="secondary"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="px-3 py-1.5 text-xs"
            >
              ออกจากระบบ
            </ActionButton>
          </div>
        </div>
      </div>
    </header>
    <nav aria-label="เมนูหลักบนมือถือ" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-[var(--line)] bg-white/95 px-1 pb-[max(env(safe-area-inset-bottom),0.25rem)] pt-1 backdrop-blur sm:hidden">
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium transition ${active ? "bg-[var(--brand-soft)] text-[var(--brand-strong)]" : "text-[var(--muted)]"}`}>
            <NavGlyph name={link.icon} />
            <span>{link.shortLabel}</span>
          </Link>
        );
      })}
    </nav>
    </>
  );
}

function NavGlyph({ name }: { name: string }) {
  const common = { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return <NavIcon>{name === "plus" ? <svg {...common}><path d="M12 5v14M5 12h14" /></svg> : name === "check" ? <svg {...common}><path d="m5 12 4 4L19 6" /></svg> : name === "chart" ? <svg {...common}><path d="M4 19V5M4 19h16M8 16v-5M12 16V7M16 16V9" /></svg> : <svg {...common}><path d="M6 3h9l3 3v15H6z" /><path d="M15 3v4h4M9 12h6M9 16h6" /></svg>}</NavIcon>;
}

/** Greets by time of day — the clock was already here, so this is free warmth. */
function greetingFor(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "สวัสดีตอนเช้า ☀️";
  if (hour < 17) return "สวัสดีตอนบ่าย 🌤️";
  return "สวัสดีตอนเย็น 🌙";
}
