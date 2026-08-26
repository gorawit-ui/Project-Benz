import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import CaptureFlow from "@/components/CaptureFlow";

export default async function MainPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  return <CaptureFlow recordedByName={session.user?.name ?? session.user?.email ?? ""} />;
}
