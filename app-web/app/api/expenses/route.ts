import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTeamByKey } from "@/lib/teams";
import {
  appendExpenseRow,
  ensureMonthTabExists,
  generateExpenseId,
  listExpenseRows,
  type DocumentType,
  type ExpenseRow,
  type FundType,
} from "@/lib/sheets";
import { monthLabelForBillDate } from "@/lib/month";

/**
 * GET /api/expenses?month=<tabName>|?billDate=YYYY-MM-DD — lists every row
 * of one month's tab in the caller's own team's sheet (used by the
 * review/dashboard pages). Resolves the target tab as: the literal `month`
 * tab name if given, else the month containing `billDate` if given, else
 * today's month. Returns the resolved tab name too, as `month`, so the
 * client knows what it just loaded.
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

  const monthParam = req.nextUrl.searchParams.get("month");
  const billDateParam = req.nextUrl.searchParams.get("billDate");
  const tabName =
    monthParam && monthParam.trim()
      ? monthParam.trim()
      : monthLabelForBillDate(billDateParam?.trim() || undefined);

  try {
    await ensureMonthTabExists(session.accessToken, team.sheetId, tabName);
    const rows = await listExpenseRows(session.accessToken, team.sheetId, tabName);
    return NextResponse.json({ rows, month: tabName });
  } catch (err) {
    console.error("GET /api/expenses failed", err);
    return NextResponse.json({ error: "อ่านข้อมูลจาก Google Sheet ไม่สำเร็จ" }, { status: 500 });
  }
}

const REQUIRED_FIELDS = [
  "fundType",
  "documentType",
  "documentNumber",
  "billDate",
  "supplierNameTh",
  "expenseDetail",
  "odooCategory",
  "amountBeforeVat",
  "vatAmount",
  "grandTotal",
] as const;

type ExpenseSubmission = Record<(typeof REQUIRED_FIELDS)[number], unknown> & {
  poNumber?: string;
  supplierNameEn?: string;
  costCenter?: string;
  accName?: string;
  receiptFileLink?: string;
  duplicateWarning?: string;
};

/** POST /api/expenses — validates and appends one manual-entry expense row. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken || !session.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const team = getTeamByKey(session.team?.key);
  if (!team?.sheetId) {
    return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า Google Sheet ของทีมนี้" }, { status: 500 });
  }

  let body: Partial<ExpenseSubmission>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  for (const field of REQUIRED_FIELDS) {
    const value = body[field];
    if (value === undefined || value === null || value === "") {
      return NextResponse.json({ error: `missing required field: ${field}` }, { status: 400 });
    }
  }

  const row: Omit<ExpenseRow, "id"> = {
    recordedAt: new Date().toISOString(),
    recordedBy: session.user.name ?? session.user.email ?? "unknown",
    status: "รอตรวจ",
    fundType: body.fundType as FundType,
    documentType: body.documentType as DocumentType,
    documentNumber: String(body.documentNumber),
    poNumber: body.poNumber ? String(body.poNumber) : "",
    billDate: String(body.billDate),
    supplierNameTh: String(body.supplierNameTh),
    supplierNameEn: body.supplierNameEn ? String(body.supplierNameEn) : "",
    expenseDetail: String(body.expenseDetail),
    odooCategory: String(body.odooCategory),
    costCenter: body.costCenter ? String(body.costCenter) : team.costCenter ?? "",
    accName: body.accName ? String(body.accName) : "",
    amountBeforeVat: Number(body.amountBeforeVat),
    vatAmount: Number(body.vatAmount),
    grandTotal: Number(body.grandTotal),
    receiptFileLink: body.receiptFileLink ? String(body.receiptFileLink) : "",
    receiptDocLink: "",
    // Populated client-side by ExpenseForm's pre-submit duplicate check
    // (lib/duplicateCheck.ts) — empty when no match was found or confirmed.
    duplicateWarning: body.duplicateWarning ? String(body.duplicateWarning) : "",
    odooId: "",
    reviewedBy: "",
    reviewedAt: "",
    note: "",
    repaymentStatus: "ยังไม่จ่ายคืน",
  };

  try {
    // A late entry for a prior month must file into THAT month's own tab,
    // not today's — resolve the target tab from the submitted billDate.
    const tabName = monthLabelForBillDate(row.billDate);
    const id = await generateExpenseId(session.accessToken, team.sheetId, team.key.toUpperCase());
    const fullRow: ExpenseRow = { id, ...row };
    await ensureMonthTabExists(session.accessToken, team.sheetId, tabName);
    await appendExpenseRow(session.accessToken, team.sheetId, tabName, fullRow);
    return NextResponse.json({ row: fullRow }, { status: 201 });
  } catch (err) {
    console.error("POST /api/expenses failed", err);
    return NextResponse.json({ error: "บันทึกรายการลง Google Sheet ไม่สำเร็จ" }, { status: 500 });
  }
}
