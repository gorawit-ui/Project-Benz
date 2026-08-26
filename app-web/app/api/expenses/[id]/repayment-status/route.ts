import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTeamByKey } from "@/lib/teams";
import { updateExpenseRowRepaymentStatus, type RepaymentStatus } from "@/lib/sheets";

const VALID_REPAYMENT_STATUSES: RepaymentStatus[] = ["จ่ายคืนแล้ว", "ยังไม่จ่ายคืน"];

/** POST /api/expenses/[id]/repayment-status — mark a เงินทดรองจ่าย row as
 * repaid to the employee, or revert it back to outstanding. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken || !session.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const team = getTeamByKey(session.team?.key);
  if (!team?.sheetId) {
    return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า Google Sheet ของทีมนี้" }, { status: 500 });
  }

  const { id } = await params;

  let body: { repaymentStatus?: string; monthTab?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const repaymentStatus = body.repaymentStatus as RepaymentStatus | undefined;
  if (!repaymentStatus || !VALID_REPAYMENT_STATUSES.includes(repaymentStatus)) {
    return NextResponse.json({ error: "invalid repaymentStatus" }, { status: 400 });
  }

  if (!body.monthTab || typeof body.monthTab !== "string") {
    return NextResponse.json({ error: "missing monthTab" }, { status: 400 });
  }

  try {
    await updateExpenseRowRepaymentStatus(
      session.accessToken,
      team.sheetId,
      body.monthTab,
      id,
      repaymentStatus
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`POST /api/expenses/${id}/repayment-status failed`, err);
    return NextResponse.json({ error: "อัปเดตสถานะจ่ายคืนไม่สำเร็จ" }, { status: 500 });
  }
}
