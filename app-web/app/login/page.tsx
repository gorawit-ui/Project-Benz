"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

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

  useEffect(() => {
    if (status === "authenticated" && session) {
      router.replace("/");
    }
  }, [status, session, router]);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold text-emerald-800">TDFB Expense Tracking</h1>
        <p className="mt-2 text-sm text-zinc-500">
          ระบบบันทึกและติดตามค่าใช้จ่าย เงินสดย่อย / เงินทดรองจ่าย
        </p>

        {error && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error === "AccessDenied"
              ? "อีเมลนี้ยังไม่ได้รับสิทธิ์เข้าใช้งาน — รองรับเฉพาะอีเมล @tdfb.co ที่ถูกเพิ่มเข้าทีมในระบบแล้วเท่านั้น ติดต่อผู้ดูแลระบบหากคิดว่าควรมีสิทธิ์"
              : "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"}
          </p>
        )}

        <button
          onClick={() => signIn("google", { callbackUrl: "/" })}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-3 font-medium text-white transition-colors hover:bg-emerald-800"
        >
          เข้าสู่ระบบด้วย Google
        </button>

        <p className="mt-4 text-xs text-zinc-500">รองรับเฉพาะอีเมล @tdfb.co</p>
      </div>
    </div>
  );
}
