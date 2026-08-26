/**
 * Thin wrapper around the Google Sheets v4 API, scoped to the 25-column
 * "TDFB Expense Tracking" layout defined in docs/03-data-schema.md and built
 * by templates/sheet/build_expense_tracking_sheet.py (see its `groups`
 * variable — this file's COLUMN_HEADERS mirrors that column order exactly).
 *
 * There is no database in this phase: the Google Sheet itself IS the data
 * store, and every user acts through their own OAuth access token (no
 * shared service account).
 */
import { google, sheets_v4 } from "googleapis";

export type FundType = "เงินสดย่อย" | "เงินทดรองจ่าย";
export type DocumentType = "ใบเสร็จรับเงิน" | "ใบกำกับภาษี" | "บิลเงินสด";
export type ExpenseStatus = "รอตรวจ" | "ตรวจแล้ว" | "นับเข้าระบบ" | "ต้องแก้ไข";

/**
 * One row of the Expense Tracking sheet, field order matches the 25 columns
 * exactly (see COLUMN_HEADERS below for the literal Thai header text).
 */
export interface ExpenseRow {
  // ระบบจัดการ (system-managed)
  id: string; // รหัสรายการ
  recordedAt: string; // วันที่บันทึกเข้าระบบ (ISO timestamp)
  recordedBy: string; // ผู้บันทึก
  status: ExpenseStatus; // สถานะ

  // ประเภทเงิน
  fundType: FundType; // ประเภทเงิน (เงินสดย่อย/เงินทดรองจ่าย)

  // เอกสาร
  documentType: DocumentType; // ประเภทเอกสาร
  documentNumber: string; // เลขที่เอกสาร
  poNumber: string; // เลขที่ PO
  billDate: string; // วันที่ในบิล (Date), YYYY-MM-DD

  // คู่ค้า
  supplierNameTh: string; // ชื่อซัพพลายเออร์ (ไทย)
  supplierNameEn: string; // ชื่อซัพพลายเออร์ (English)
  expenseDetail: string; // รายละเอียดค่าใช้จ่าย (Description)

  // บัญชี (ตาม Odoo)
  odooCategory: string; // หมวดหมู่ (ตาม Odoo)
  costCenter: string; // Cost Center
  accName: string; // Acc name

  // ยอดเงิน
  amountBeforeVat: number; // จำนวนเงินก่อน VAT
  vatAmount: number; // VAT 7%
  grandTotal: number; // ยอดรวม (Grand Total)

  // ไฟล์ / หลักฐาน
  receiptFileLink: string; // ลิงก์ไฟล์ใบเสร็จ (Drive)
  receiptDocLink: string; // ลิงก์เอกสารรับเงิน (กรณีบิลไม่สมบูรณ์)
  duplicateWarning: string; // แจ้งเตือนรายการซ้ำ

  // เชื่อมต่อ Odoo
  odooId: string; // ID Odoo / ID Express

  // ตรวจทาน
  reviewedBy: string; // ผู้ตรวจทาน
  reviewedAt: string; // วันที่ตรวจทาน
  note: string; // หมายเหตุ
}

/** Literal Thai column headers, in exact sheet order (columns A..Y). */
export const COLUMN_HEADERS = [
  "รหัสรายการ",
  "วันที่บันทึกเข้าระบบ",
  "ผู้บันทึก",
  "สถานะ",
  "ประเภทเงิน (เงินสดย่อย/เงินทดรองจ่าย)",
  "ประเภทเอกสาร",
  "เลขที่เอกสาร",
  "เลขที่ PO",
  "วันที่ในบิล (Date)",
  "ชื่อซัพพลายเออร์ (ไทย)",
  "ชื่อซัพพลายเออร์ (English)",
  "รายละเอียดค่าใช้จ่าย (Description)",
  "หมวดหมู่ (ตาม Odoo)",
  "Cost Center",
  "Acc name",
  "จำนวนเงินก่อน VAT",
  "VAT 7%",
  "ยอดรวม (Grand Total)",
  "ลิงก์ไฟล์ใบเสร็จ (Drive)",
  "ลิงก์เอกสารรับเงิน (กรณีบิลไม่สมบูรณ์)",
  "แจ้งเตือนรายการซ้ำ",
  "ID Odoo / ID Express",
  "ผู้ตรวจทาน",
  "วันที่ตรวจทาน",
  "หมายเหตุ",
] as const;

// Matches ws.title in templates/sheet/build_expense_tracking_sheet.py.
const SHEET_TAB_NAME = "Expense Tracking";
// In the template file, rows 1-6 are title/subtitle/group headers/column
// headers/example row (see build_expense_tracking_sheet.py: group_row=4,
// header_row=5, example_row=6) — real data starts at row 7. If a production
// sheet is built differently, adjust this constant.
const DATA_START_ROW = 7;
// Column A..Y (25 columns).
const LAST_COLUMN_LETTER = "Y";

function columnIndexToLetter(index0: number): string {
  // 0 -> A, 24 -> Y
  return String.fromCharCode("A".charCodeAt(0) + index0);
}

/** Zero-based column index of a field, used to target single-cell updates. */
const COLUMN_INDEX = {
  id: 0,
  status: 3,
  receiptDocLink: 19,
  reviewedBy: 22,
  reviewedAt: 23,
  note: 24,
} as const;

function sheetsClient(accessToken: string): sheets_v4.Sheets {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.sheets({ version: "v4", auth });
}

/** Converts an ExpenseRow into the flat array of cell values (column order). */
export function rowToValues(row: ExpenseRow): (string | number)[] {
  return [
    row.id,
    row.recordedAt,
    row.recordedBy,
    row.status,
    row.fundType,
    row.documentType,
    row.documentNumber,
    row.poNumber,
    row.billDate,
    row.supplierNameTh,
    row.supplierNameEn,
    row.expenseDetail,
    row.odooCategory,
    row.costCenter,
    row.accName,
    row.amountBeforeVat,
    row.vatAmount,
    row.grandTotal,
    row.receiptFileLink,
    row.receiptDocLink,
    row.duplicateWarning,
    row.odooId,
    row.reviewedBy,
    row.reviewedAt,
    row.note,
  ];
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function toStr(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/** Parses one raw sheet row (array of cell values) back into an ExpenseRow. */
export function valuesToRow(values: unknown[]): ExpenseRow {
  return {
    id: toStr(values[0]),
    recordedAt: toStr(values[1]),
    recordedBy: toStr(values[2]),
    status: toStr(values[3]) as ExpenseStatus,
    fundType: toStr(values[4]) as FundType,
    documentType: toStr(values[5]) as DocumentType,
    documentNumber: toStr(values[6]),
    poNumber: toStr(values[7]),
    billDate: toStr(values[8]),
    supplierNameTh: toStr(values[9]),
    supplierNameEn: toStr(values[10]),
    expenseDetail: toStr(values[11]),
    odooCategory: toStr(values[12]),
    costCenter: toStr(values[13]),
    accName: toStr(values[14]),
    amountBeforeVat: toNumber(values[15]),
    vatAmount: toNumber(values[16]),
    grandTotal: toNumber(values[17]),
    receiptFileLink: toStr(values[18]),
    receiptDocLink: toStr(values[19]),
    duplicateWarning: toStr(values[20]),
    odooId: toStr(values[21]),
    reviewedBy: toStr(values[22]),
    reviewedAt: toStr(values[23]),
    note: toStr(values[24]),
  };
}

/** Generates a new "รหัสรายการ" (system id). Not sequential — a timestamp-
 * based unique id. Real sequential numbering (e.g. EX-2026-0001) would need
 * to read the sheet's current max id first; left as a follow-up. */
export function generateExpenseId(): string {
  return `EX-${Date.now().toString(36).toUpperCase()}`;
}

/** Appends one expense row to the end of the Expense Tracking table. */
export async function appendExpenseRow(
  accessToken: string,
  sheetId: string,
  row: ExpenseRow
): Promise<void> {
  const sheets = sheetsClient(accessToken);
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `'${SHEET_TAB_NAME}'!A1:${LAST_COLUMN_LETTER}1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [rowToValues(row)],
    },
  });
}

/** Reads every expense row currently in the sheet. */
export async function listExpenseRows(
  accessToken: string,
  sheetId: string
): Promise<ExpenseRow[]> {
  const sheets = sheetsClient(accessToken);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${SHEET_TAB_NAME}'!A${DATA_START_ROW}:${LAST_COLUMN_LETTER}`,
  });

  const rows = res.data.values ?? [];
  return rows
    .filter((r) => r && r[COLUMN_INDEX.id]) // skip blank rows
    .map((r) => valuesToRow(r));
}

/**
 * Finds the sheet row number (1-based, matching the Sheets API) whose
 * "รหัสรายการ" cell equals rowId. Returns null when not found.
 */
async function findRowNumberById(
  sheets: sheets_v4.Sheets,
  sheetId: string,
  rowId: string
): Promise<number | null> {
  const idColumnLetter = columnIndexToLetter(COLUMN_INDEX.id);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${SHEET_TAB_NAME}'!${idColumnLetter}${DATA_START_ROW}:${idColumnLetter}`,
  });
  const ids = res.data.values ?? [];
  const offset = ids.findIndex((r) => r && r[0] === rowId);
  if (offset === -1) return null;
  return DATA_START_ROW + offset;
}

/**
 * Updates a row's status (and optionally reviewer/date/note), matched by
 * "รหัสรายการ" (rowId) rather than by array position, since sheet rows can
 * be reordered/filtered by users.
 */
export async function updateExpenseRowStatus(
  accessToken: string,
  sheetId: string,
  rowId: string,
  status: ExpenseStatus,
  reviewer?: { reviewedBy?: string; note?: string }
): Promise<void> {
  const sheets = sheetsClient(accessToken);
  const rowNumber = await findRowNumberById(sheets, sheetId, rowId);
  if (rowNumber === null) {
    throw new Error(`ไม่พบรายการที่รหัส "${rowId}" ในชีท`);
  }

  const statusLetter = columnIndexToLetter(COLUMN_INDEX.status);
  const reviewedByLetter = columnIndexToLetter(COLUMN_INDEX.reviewedBy);
  const reviewedAtLetter = columnIndexToLetter(COLUMN_INDEX.reviewedAt);
  const noteLetter = columnIndexToLetter(COLUMN_INDEX.note);

  const data: sheets_v4.Schema$ValueRange[] = [
    {
      range: `'${SHEET_TAB_NAME}'!${statusLetter}${rowNumber}`,
      values: [[status]],
    },
    {
      range: `'${SHEET_TAB_NAME}'!${reviewedByLetter}${rowNumber}:${reviewedAtLetter}${rowNumber}`,
      values: [[reviewer?.reviewedBy ?? "", new Date().toISOString()]],
    },
  ];
  if (reviewer?.note) {
    data.push({
      range: `'${SHEET_TAB_NAME}'!${noteLetter}${rowNumber}`,
      values: [[reviewer.note]],
    });
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data,
    },
  });
}

/**
 * Writes a Drive link into a row's "ลิงก์เอกสารรับเงิน" column, matched by
 * "รหัสรายการ" (same find-by-id pattern as updateExpenseRowStatus). Used
 * when a generated เอกสารรับเงิน .docx is linked back to the expense row it
 * was created for.
 */
export async function updateExpenseRowReceiptDocLink(
  accessToken: string,
  sheetId: string,
  rowId: string,
  link: string
): Promise<void> {
  const sheets = sheetsClient(accessToken);
  const rowNumber = await findRowNumberById(sheets, sheetId, rowId);
  if (rowNumber === null) {
    throw new Error(`ไม่พบรายการที่รหัส "${rowId}" ในชีท`);
  }

  const linkLetter = columnIndexToLetter(COLUMN_INDEX.receiptDocLink);
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${SHEET_TAB_NAME}'!${linkLetter}${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[link]] },
  });
}
