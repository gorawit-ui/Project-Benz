"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Suspense, useEffect, useState } from "react";
import BilliMascot from "@/components/BilliMascot";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (status === "authenticated" && session) {
      router.replace("/");
    }
  }, [status, session, router]);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-10">
      {/*
       * Two panes above sm, stacked below it: the team illustration is
       * portrait (0.89:1), which reads fine stacked on a phone but would
       * shrink to nothing squeezed beside the form on a narrow screen — so
       * it gets top billing on mobile and the left column on desktop.
       */}
      <div className="flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm sm:flex-row">
        <div className="relative flex items-center justify-center bg-emerald-50/60 p-4 sm:w-[42%] sm:p-8">
          <Image
            src="/team-illustration.png"
            alt="ทีม GM & HR"
            width={1091}
            height={1223}
            // Real display width is much smaller than the source, so sizes
            // tells next/image which resized variant to actually serve.
            sizes="(min-width: 640px) 260px, 150px"
            className="h-auto w-full max-w-[150px] sm:max-w-[260px]"
            priority
          />
          <BilliMascot mood="idle" size="sm" className="absolute bottom-3 right-3 sm:bottom-5 sm:right-5" />
        </div>

        <div className="flex-1 p-6 text-center sm:p-10 sm:text-left">
          <p className="text-4xl">🍃</p>
          <h1 className="mt-2 text-2xl font-bold text-emerald-800">TDFB Expense Tracking</h1>
          <p className="mt-2 text-sm text-zinc-500">
            ยินดีต้อนรับ! บันทึกง่าย ตรวจสอบได้ทุกบิล
            <br />
            เงินสดย่อย / เงินทดรองจ่าย ของทีม
          </p>

          {error && (
            <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error === "AccessDenied"
                ? "อีเมลนี้ยังไม่ได้รับสิทธิ์เข้าใช้งาน — รองรับเฉพาะอีเมล @tdfb.co ที่ถูกเพิ่มเข้าทีมในระบบแล้วเท่านั้น ติดต่อผู้ดูแลระบบหากคิดว่าควรมีสิทธิ์"
                : "เข้าสู่ระบบไม่สำเร็จ 😅 ลองใหม่อีกทีนะ"}
            </p>
          )}

          <button
            onClick={() => {
              setSigningIn(true);
              signIn("google", { callbackUrl: "/" });
            }}
            disabled={signingIn}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-3 font-medium text-white transition-all duration-150 hover:bg-emerald-800 active:scale-[0.97] active:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-70 disabled:active:scale-100"
          >
            {signingIn ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                กำลังพาไปหน้า Google...
              </>
            ) : (
              "เข้าสู่ระบบด้วย Google"
            )}
          </button>

          <p className="mt-4 text-xs text-zinc-500">รองรับเฉพาะอีเมล @tdfb.co</p>
        </div>
      </div>
    </div>
  );
}
