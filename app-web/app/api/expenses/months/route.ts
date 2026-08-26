import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTeamByKey } from "@/lib/teams";
import { listMonthTabNames } from "@/lib/sheets";

/**
 * GET /api/expenses/months — lists every per-month data tab name in the
 * caller's own team's sheet, sorted most-recent-first. Powers the
 * month-picker dropdown in ReviewList/DashboardView.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const team = getTeamByKey(session.team?.key);
  if (!team?.sheetId) {
    return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า Google Sheet ของทีมนี้" }, { status: 500 });
  }

  try {
    const months = await listMonthTabNames(session.accessToken, team.sheetId);
    return NextResponse.json({ months });
  } catch (err) {
    console.error("GET /api/expenses/months failed", err);
    return NextResponse.json({ error: "อ่านรายชื่อแท็บเดือนจาก Google Sheet ไม่สำเร็จ" }, { status: 500 });
  }
}
