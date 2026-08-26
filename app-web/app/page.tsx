import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import ExpenseForm from "@/components/ExpenseForm";

export default async function MainPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-bold text-emerald-900">บันทึกค่าใช้จ่าย</h1>
      <p className="mt-1 text-sm text-zinc-500">
        กรอกข้อมูลจากใบเสร็จ/บิลด้วยตนเอง (ยังไม่มี OCR ในเฟสนี้) แล้วบันทึกเข้าสถานะ &ldquo;รอตรวจ&rdquo;
      </p>
      <div className="mt-6">
        <ExpenseForm recordedByName={session.user?.name ?? session.user?.email ?? ""} />
      </div>
    </div>
  );
}
