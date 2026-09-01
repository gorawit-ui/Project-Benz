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
import { findDuplicateExpense } from "@/lib/duplicateCheck";
import { monthLabelForBillDate } from "@/lib/month";

const REQUIRED_FIELDS = ["fundType", "documentType", "documentNumber", "billDate", "supplierNameTh", "expenseDetail", "odooCategory", "grandTotal", "receiptFileLink"] as const;

type BatchItem = Record<(typeof REQUIRED_FIELDS)[number], unknown> & {
  poNumber?: string;
  supplierNameEn?: string;
  costCenter?: string;
  accName?: string;
  amountBeforeVat?: unknown;
  vatAmount?: unknown;
  hasVat?: boolean;
};

function normaliseTaxAmounts(item: BatchItem) {
  const grandTotal = Number(item.grandTotal);
  const hasVat = item.hasVat !== false;
  const amountBeforeVat = hasVat ? Number(item.amountBeforeVat) : grandTotal;
  const vatAmount = hasVat ? Number(item.vatAmount) : 0;
  return { amountBeforeVat, vatAmount, grandTotal };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken || !session.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const team = getTeamByKey(session.team?.key);
  if (!team?.sheetId) return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า Google Sheet ของทีมนี้" }, { status: 500 });

  let body: { items?: BatchItem[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length < 2) {
    return NextResponse.json({ error: "การบันทึกแบบหลายบิลต้องมีอย่างน้อย 2 รายการ" }, { status: 400 });
  }
  if (body.items.length > 20) {
    return NextResponse.json({ error: "บันทึกได้ครั้งละไม่เกิน 20 บิล" }, { status: 400 });
  }

  for (const item of body.items) {
    for (const field of REQUIRED_FIELDS) {
      if (item[field] === undefined || item[field] === null || item[field] === "") {
        return NextResponse.json({ error: "ข้อมูลไม่ครบ: " + field }, { status: 400 });
      }
    }
    const amounts = normaliseTaxAmounts(item);
    if (![amounts.amountBeforeVat, amounts.vatAmount, amounts.grandTotal].every(Number.isFinite) || amounts.grandTotal <= 0) {
      return NextResponse.json({ error: "จำนวนเงินไม่ถูกต้อง" }, { status: 400 });
    }
  }

  try {
    const existingByMonth = new Map<string, ExpenseRow[]>();
    const created: ExpenseRow[] = [];
    const recordedAt = new Date().toISOString();
    const reviewer = session.user.name ?? session.user.email ?? "";

    for (const item of body.items) {
      const amounts = normaliseTaxAmounts(item);
      const tabName = monthLabelForBillDate(String(item.billDate));
      if (!existingByMonth.has(tabName)) {
        await ensureMonthTabExists(session.accessToken, team.sheetId, tabName);
        existingByMonth.set(tabName, await listExpenseRows(session.accessToken, team.sheetId, tabName));
      }

      const previous = existingByMonth.get(tabName) ?? [];
      const duplicate = findDuplicateExpense(previous, {
        supplierNameTh: String(item.supplierNameTh),
        grandTotal: amounts.grandTotal,
        billDate: String(item.billDate),
      });
      if (duplicate) {
        return NextResponse.json({ error: "พบรายการอาจซ้ำกับ " + duplicate.id + " — กรุณาตรวจสอบก่อนส่งชุดนี้" }, { status: 409 });
      }

      const id = await generateExpenseId(session.accessToken, team.sheetId, team.key.toUpperCase());
      const row: ExpenseRow = {
        id,
        recordedAt,
        recordedBy: reviewer,
        status: "ตรวจแล้ว",
        fundType: item.fundType as FundType,
        documentType: item.documentType as DocumentType,
        documentNumber: String(item.documentNumber),
        poNumber: item.poNumber ? String(item.poNumber) : "",
        billDate: String(item.billDate),
        supplierNameTh: String(item.supplierNameTh),
        supplierNameEn: item.supplierNameEn ? String(item.supplierNameEn) : "",
        expenseDetail: String(item.expenseDetail),
        odooCategory: String(item.odooCategory),
        costCenter: item.costCenter ? String(item.costCenter) : team.costCenter ?? "",
        accName: item.accName ? String(item.accName) : "",
        amountBeforeVat: amounts.amountBeforeVat,
        vatAmount: amounts.vatAmount,
        grandTotal: amounts.grandTotal,
        receiptFileLink: String(item.receiptFileLink),
        receiptDocLink: "",
        duplicateWarning: "",
        odooId: "",
        reviewedBy: reviewer,
        reviewedAt: recordedAt,
        note: "อนุมัติอัตโนมัติจากการส่งหลายบิล",
        repaymentStatus: "ยังไม่จ่ายคืน",
      };
      await appendExpenseRow(session.accessToken, team.sheetId, tabName, row);
      previous.push(row);
      created.push(row);
    }

    return NextResponse.json({ rows: created }, { status: 201 });
  } catch (err) {
    console.error("POST /api/expenses/batch failed", err);
    return NextResponse.json({ error: "บันทึกชุดเอกสารลง Google Sheet ไม่สำเร็จ" }, { status: 500 });
  }
}
