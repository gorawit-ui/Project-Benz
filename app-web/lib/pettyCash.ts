/**
 * เงินสดย่อย (petty cash) vs เงินทดรองจ่าย (reimbursement/advance) auto-
 * classification, per the rule confirmed by the product owner (see
 * docs/02-requirements-from-pop.md, "กติกาอัตโนมัติสำหรับจำแนกประเภทเงิน" and
 * docs/04-open-items.md's now-resolved split-billing question):
 *
 *   ป๊อป (verbatim): "ถ้ายอด petty cash ใช้ไป 19500 แล้ว และมียอดใหม่เข้ามา 1000
 *   ให้ 1000 ตีเป็น ทดรองจ่าย แต่ถ้ามีรายการไหนที่ยอดพอดี ให้ตีเป็น petty cash"
 *
 * i.e. เงินสดย่อย spend is tracked cumulatively per calendar month (นับสะสม
 * ไม่เรียงวันที่ — summed across all rows in that month regardless of
 * day-of-month order). A new bill of amount X is classified as เงินสดย่อย
 * only if the running total (existing + X) still fits under the monthly
 * threshold; otherwise the WHOLE bill becomes เงินทดรองจ่าย. A single bill is
 * never split across the two categories.
 */
import { ensureMonthTabExists, listExpenseRows, type ExpenseRow, type FundType } from "./sheets";
import { monthLabelForBillDate } from "./month";

/** Monthly เงินสดย่อย ceiling, confirmed by the product owner. */
export const PETTY_CASH_MONTHLY_THRESHOLD = 20000;

/** Extracts "YYYY-MM" from a "YYYY-MM-DD" billDate string, or null if malformed. */
function yearMonthOf(billDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-\d{2}/.exec(billDate);
  return match ? `${match[1]}-${match[2]}` : null;
}

/**
 * Sums grandTotal across every existing row with fundType === "เงินสดย่อย"
 * whose billDate falls in the same calendar year+month as referenceDate.
 * Pure function over an already-fetched row list, split out from the
 * network call below so it's independently testable.
 */
export function sumPettyCashForMonth(rows: ExpenseRow[], referenceDate: string): number {
  const targetYearMonth = yearMonthOf(referenceDate);
  if (!targetYearMonth) return 0;

  return rows
    .filter(
      (row) =>
        row.fundType === "เงินสดย่อย" &&
        row.status !== "ยกเลิก" && // cancelling returns the amount to this month's available balance
        yearMonthOf(row.billDate) === targetYearMonth
    )
    .reduce((sum, row) => sum + row.grandTotal, 0);
}

/**
 * Fetches every row for referenceDate's own month tab and sums this month's
 * เงินสดย่อย usage. Ensures that month's tab exists first (cheap no-op once
 * it does) so a brand new month with zero rows yet doesn't error.
 */
export async function getPettyCashUsedThisMonth(
  accessToken: string,
  sheetId: string,
  referenceDate: string
): Promise<number> {
  const tabName = monthLabelForBillDate(referenceDate);
  await ensureMonthTabExists(accessToken, sheetId, tabName);
  const rows = await listExpenseRows(accessToken, sheetId, tabName);
  return sumPettyCashForMonth(rows, referenceDate);
}

/**
 * Classifies one new bill given how much เงินสดย่อย has already been used
 * this month. Never splits a bill: the whole amount goes to whichever
 * category the running total lands in.
 */
export function classifyFundType(usedThisMonth: number, newBillAmount: number): FundType {
  return usedThisMonth + newBillAmount <= PETTY_CASH_MONTHLY_THRESHOLD ? "เงินสดย่อย" : "เงินทดรองจ่าย";
}
