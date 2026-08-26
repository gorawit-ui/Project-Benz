import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import DashboardView from "@/components/DashboardView";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-xl font-bold text-emerald-900">ภาพรวมค่าใช้จ่ายทีม</h1>
      <p className="mt-1 text-sm text-zinc-500">สรุปเงินสดย่อย เงินทดรองจ่าย และรายการทั้งหมดของทีม</p>
      <div className="mt-6">
        <DashboardView />
      </div>
    </div>
  );
}
