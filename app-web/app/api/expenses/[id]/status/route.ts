import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTeamByKey } from "@/lib/teams";
import { updateExpenseRowStatus, type ExpenseStatus } from "@/lib/sheets";

const VALID_STATUSES: ExpenseStatus[] = ["รอตรวจ", "ตรวจแล้ว", "นับเข้าระบบ", "ต้องแก้ไข"];

/** POST /api/expenses/[id]/status — reviewer sets ตรวจแล้ว / ต้องแก้ไข / etc. */
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

  let body: { status?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const status = body.status as ExpenseStatus | undefined;
  if (!status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  try {
    await updateExpenseRowStatus(session.accessToken, team.sheetId, id, status, {
      reviewedBy: session.user.name ?? session.user.email ?? "",
      note: body.note ?? "",
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`POST /api/expenses/${id}/status failed`, err);
    return NextResponse.json({ error: "อัปเดตสถานะไม่สำเร็จ" }, { status: 500 });
  }
}
