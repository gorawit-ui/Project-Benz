import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import ReceiptDocForm from "@/components/ReceiptDocForm";

export default async function CreateReceiptDocPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-xl font-bold text-emerald-900">สร้างเอกสารรับเงิน</h1>
      <p className="mt-1 text-sm text-zinc-500">
        ใช้เมื่อบิลไม่มีใบเสร็จแบบเป็นทางการ (เช่น ร้านสะดวกซื้อ) — ระบบจะสร้างไฟล์ .docx ให้พร้อมข้อมูล
      </p>
      <div className="mt-6">
        <ReceiptDocForm defaultPayeeName={session.user?.name ?? ""} />
      </div>
    </div>
  );
}
