import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTeamByKey } from "@/lib/teams";
import { getPettyCashUsedThisMonth, PETTY_CASH_MONTHLY_THRESHOLD } from "@/lib/pettyCash";

/**
 * GET /api/expenses/petty-cash-status?billDate=YYYY-MM-DD — sums this
 * calendar month's เงินสดย่อย usage (the month is taken from `billDate`,
 * falling back to today when omitted) so the client can auto-select the
 * fund-type toggle per the ฿20,000/month rule (see lib/pettyCash.ts).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const team = getTeamByKey(session.team?.key);
  if (!team?.sheetId) {
    return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า Google Sheet ของทีมนี้" }, { status: 500 });
  }

  const billDate = req.nextUrl.searchParams.get("billDate");
  const referenceDate = billDate && billDate.trim() ? billDate.trim() : new Date().toISOString().slice(0, 10);

  try {
    const usedThisMonth = await getPettyCashUsedThisMonth(session.accessToken, team.sheetId, referenceDate);
    return NextResponse.json({ usedThisMonth, threshold: PETTY_CASH_MONTHLY_THRESHOLD });
  } catch (err) {
    console.error("GET /api/expenses/petty-cash-status failed", err);
    return NextResponse.json({ error: "คำนวณยอดเงินสดย่อยสะสมไม่สำเร็จ" }, { status: 500 });
  }
}
