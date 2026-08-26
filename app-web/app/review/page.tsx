import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import ReviewList from "@/components/ReviewList";

export default async function ReviewPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-xl font-bold text-emerald-900">ตรวจทานรายการ</h1>
      <p className="mt-1 text-sm text-zinc-500">รายการที่มีสถานะ &ldquo;รอตรวจ&rdquo;</p>
      <div className="mt-6">
        <ReviewList />
      </div>
    </div>
  );
}
