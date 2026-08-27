/**
 * Thin wrapper around the Google Sheets v4 API, scoped to the 26-column
 * "TDFB Expense Tracking" layout defined in docs/03-data-schema.md and built
 * by templates/sheet/build_expense_tracking_sheet.py (see its `groups`
 * variable — this file's COLUMN_HEADERS mirrors that column order exactly).
 *
 * There is no database in this phase: the Google Sheet itself IS the data
 * store, and every user acts through their own OAuth access token (no
 * shared service account).
 */
import { google, sheets_v4 } from "googleapis";
import { isMonthTabName } from "./month";

export type FundType = "เงินสดย่อย" | "เงินทดรองจ่าย";
export type DocumentType = "ใบเสร็จรับเงิน" | "ใบกำกับภาษี" | "บิลเงินสด";
export type ExpenseStatus = "รอตรวจ" | "ตรวจแล้ว" | "นับเข้าระบบ" | "ต้องแก้ไข" | "ยกเลิก";
// Only meaningful for fundType === "เงินทดรองจ่าย" (the employee paid out of
// pocket and is owed a reimbursement) — ignored for "เงินสดย่อย" rows.
export type RepaymentStatus = "จ่ายคืนแล้ว" | "ยังไม่จ่ายคืน";

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

  // ติดตามการจ่ายคืน (เฉพาะเงินทดรองจ่าย)
  repaymentStatus: RepaymentStatus; // สถานะจ่ายคืน
}

/** Literal Thai column headers, in exact sheet order (columns A..Z). */
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
  "สถานะจ่ายคืน (เฉพาะเงินทดรองจ่าย)",
] as const;

// Matches ws.title in templates/sheet/build_expense_tracking_sheet.py. This
// is the STRUCTURAL TEMPLATE tab — every team's Google Sheet has exactly one
// tab with this literal title, containing rows 1-6 (title/instructions/group
// headers/column headers/example row) and no real data. Each calendar
// month's real expense rows live in their OWN tab (see ensureMonthTabExists
// below), duplicated from this template the first time something is written
// for that month — this constant is never used as a data tab name itself.
const TEMPLATE_TAB_NAME = "Expense Tracking";
// In the template file, rows 1-6 are title/subtitle/group headers/column
// headers/example row (see build_expense_tracking_sheet.py: group_row=4,
// header_row=5, example_row=6) — real data starts at row 7. If a production
// sheet is built differently, adjust this constant.
const HEADER_ROW = 5;
const DATA_START_ROW = 7;
// Column A..Z (26 columns).
const LAST_COLUMN_LETTER = "Z";

function columnIndexToLetter(index0: number): string {
  // 0 -> A, 25 -> Z
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
  repaymentStatus: 25,
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
    row.repaymentStatus,
  ];
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function toStr(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

// Older rows (written before this column existed) have no cell here at all —
// treat anything other than the literal "จ่ายคืนแล้ว" as still outstanding,
// which is the correct default (nothing has been marked repaid yet).
function toRepaymentStatus(value: unknown): RepaymentStatus {
  return toStr(value) === "จ่ายคืนแล้ว" ? "จ่ายคืนแล้ว" : "ยังไม่จ่ายคืน";
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
    repaymentStatus: toRepaymentStatus(values[25]),
  };
}

/**
 * Generates the next sequential "รหัสรายการ" for `prefix` (the team's key,
 * uppercased — "GM", "HR", ...), e.g. "GM00001", "GM00002". Each team has
 * its own separate spreadsheet, so this only needs to stay unique within
 * it: scans every month tab's ID column for the highest existing
 * `${prefix}NNNNN` id and returns the next one (starting at 1 if none
 * exist yet). Scanning is cheap — one single-column range read per month
 * tab, done in parallel, a handful of tabs at most for a pilot team.
 */
export async function generateExpenseId(accessToken: string, sheetId: string, prefix: string): Promise<string> {
  const sheets = sheetsClient(accessToken);
  const tabNames = await listMonthTabNames(accessToken, sheetId);
  const idColumnLetter = columnIndexToLetter(COLUMN_INDEX.id);

  const idsByTab = await Promise.all(
    tabNames.map((tabName) =>
      sheets.spreadsheets.values
        .get({ spreadsheetId: sheetId, range: `'${tabName}'!${idColumnLetter}${DATA_START_ROW}:${idColumnLetter}` })
        .then((res) => (res.data.values ?? []).map((r) => r[0]))
    )
  );

  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const ids of idsByTab) {
    for (const id of ids) {
      const match = typeof id === "string" ? pattern.exec(id) : null;
      if (match) max = Math.max(max, Number(match[1]));
    }
  }

  return `${prefix}${String(max + 1).padStart(5, "0")}`;
}

/**
 * Writes the "สถานะจ่ายคืน" header into `tabName`'s header row if that cell
 * is still blank. Exists so tabs created before this column was added (the
 * template tab, and every month tab duplicated from it before today) pick up
 * the header the first time they're touched, without a manual migration —
 * the app never requires the header cell to be present to read/write the
 * data column itself (Sheets allows writing to any cell), this only keeps
 * the header label visible to humans opening the sheet directly.
 */
async function ensureRepaymentStatusHeader(
  sheets: sheets_v4.Sheets,
  sheetId: string,
  tabName: string
): Promise<void> {
  const letter = columnIndexToLetter(COLUMN_INDEX.repaymentStatus);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${tabName}'!${letter}${HEADER_ROW}`,
  });
  const current = res.data.values?.[0]?.[0];
  if (current) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${tabName}'!${letter}${HEADER_ROW}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[COLUMN_HEADERS[COLUMN_INDEX.repaymentStatus]]] },
  });
}

/**
 * Ensures a tab titled exactly `monthTabName` exists in the spreadsheet,
 * creating it (as a duplicate of the TEMPLATE_TAB_NAME tab) if it doesn't
 * yet. No-op if the tab already exists. This is how each calendar month
 * gets its own tab, mirroring lib/drive.ts's per-month Drive folder — the
 * duplicated tab carries over rows 1-6 (title/instructions/headers/example)
 * from the template, which is fine since DATA_START_ROW = 7 means the
 * example row is never read as real data.
 */
export async function ensureMonthTabExists(
  accessToken: string,
  sheetId: string,
  monthTabName: string
): Promise<void> {
  const sheets = sheetsClient(accessToken);
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets.properties(sheetId,title,index)",
  });
  const allSheets = meta.data.sheets ?? [];

  if (allSheets.some((s) => s.properties?.title === TEMPLATE_TAB_NAME)) {
    // Heal the template tab too, so every month tab duplicated from here on
    // already carries the header — cheap (a single-cell read) and idempotent.
    await ensureRepaymentStatusHeader(sheets, sheetId, TEMPLATE_TAB_NAME);
  }

  const alreadyExists = allSheets.some((s) => s.properties?.title === monthTabName);
  if (alreadyExists) {
    await ensureRepaymentStatusHeader(sheets, sheetId, monthTabName);
    return;
  }

  const template = allSheets.find((s) => s.properties?.title === TEMPLATE_TAB_NAME);
  const templateSheetId = template?.properties?.sheetId;
  if (templateSheetId === undefined || templateSheetId === null) {
    throw new Error('ไม่พบแท็บต้นแบบ "Expense Tracking" ในไฟล์ Google Sheet — สร้างแท็บเดือนใหม่ไม่ได้');
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [
        {
          duplicateSheet: {
            sourceSheetId: templateSheetId,
            insertSheetIndex: allSheets.length,
            newSheetName: monthTabName,
          },
        },
      ],
    },
  });
}

/**
 * Lists every per-month data tab name in the spreadsheet, sorted
 * most-recent-first. Matches tabs by the "<YYYY>-<MM> <name>" label pattern
 * (see lib/month.ts's isMonthTabName) rather than merely excluding
 * TEMPLATE_TAB_NAME — a spreadsheet can carry other non-data tabs (e.g. a
 * "คำอธิบาย" legend tab explaining the columns) that must never be treated
 * as a selectable month or read as if it held expense rows. String-sort
 * descending works correctly on the matched titles because the label's
 * "<YYYY>-<MM>" prefix is fixed-width and zero-padded.
 */
export async function listMonthTabNames(accessToken: string, sheetId: string): Promise<string[]> {
  const sheets = sheetsClient(accessToken);
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets.properties(sheetId,title,index)",
  });
  const allSheets = meta.data.sheets ?? [];
  return allSheets
    .map((s) => s.properties?.title)
    .filter((title): title is string => !!title && isMonthTabName(title))
    .sort((a, b) => b.localeCompare(a));
}

/**
 * Row number (1-based) the next appended row should go to: DATA_START_ROW
 * plus however many รหัสรายการ cells are already filled in from there down.
 * Deliberately not `values.append` — append asks Sheets to auto-detect
 * "the end of the table" starting from A1, which lands one row too high
 * (row 6 instead of 7) the moment row 6 (the example row) is empty/deleted,
 * silently writing data outside DATA_START_ROW where listExpenseRows never
 * looks for it. Computing the row explicitly is correct regardless of
 * what's above it.
 */
async function findNextDataRow(sheets: sheets_v4.Sheets, sheetId: string, tabName: string): Promise<number> {
  const idColumnLetter = columnIndexToLetter(COLUMN_INDEX.id);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${tabName}'!${idColumnLetter}${DATA_START_ROW}:${idColumnLetter}`,
  });
  const ids = res.data.values ?? [];
  return DATA_START_ROW + ids.length;
}

/** Appends one expense row to the end of the given month tab's table. */
export async function appendExpenseRow(
  accessToken: string,
  sheetId: string,
  tabName: string,
  row: ExpenseRow
): Promise<void> {
  const sheets = sheetsClient(accessToken);
  const targetRow = await findNextDataRow(sheets, sheetId, tabName);
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${tabName}'!A${targetRow}:${LAST_COLUMN_LETTER}${targetRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [rowToValues(row)],
    },
  });
}

/** Reads every expense row currently in the given month tab. */
export async function listExpenseRows(
  accessToken: string,
  sheetId: string,
  tabName: string
): Promise<ExpenseRow[]> {
  const sheets = sheetsClient(accessToken);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${tabName}'!A${DATA_START_ROW}:${LAST_COLUMN_LETTER}`,
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
  tabName: string,
  rowId: string
): Promise<number | null> {
  const idColumnLetter = columnIndexToLetter(COLUMN_INDEX.id);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${tabName}'!${idColumnLetter}${DATA_START_ROW}:${idColumnLetter}`,
  });
  const ids = res.data.values ?? [];
  const offset = ids.findIndex((r) => r && r[0] === rowId);
  if (offset === -1) return null;
  return DATA_START_ROW + offset;
}

/**
 * Updates a row's status (and optionally reviewer/date/note), matched by
 * "รหัสรายการ" (rowId) rather than by array position, since sheet rows can
 * be reordered/filtered by users. `tabName` identifies which month tab the
 * row lives in.
 */
export async function updateExpenseRowStatus(
  accessToken: string,
  sheetId: string,
  tabName: string,
  rowId: string,
  status: ExpenseStatus,
  reviewer?: { reviewedBy?: string; note?: string }
): Promise<void> {
  const sheets = sheetsClient(accessToken);
  const rowNumber = await findRowNumberById(sheets, sheetId, tabName, rowId);
  if (rowNumber === null) {
    throw new Error(`ไม่พบรายการที่รหัส "${rowId}" ในชีท`);
  }

  const statusLetter = columnIndexToLetter(COLUMN_INDEX.status);
  const reviewedByLetter = columnIndexToLetter(COLUMN_INDEX.reviewedBy);
  const reviewedAtLetter = columnIndexToLetter(COLUMN_INDEX.reviewedAt);
  const noteLetter = columnIndexToLetter(COLUMN_INDEX.note);

  const data: sheets_v4.Schema$ValueRange[] = [
    {
      range: `'${tabName}'!${statusLetter}${rowNumber}`,
      values: [[status]],
    },
    {
      range: `'${tabName}'!${reviewedByLetter}${rowNumber}:${reviewedAtLetter}${rowNumber}`,
      values: [[reviewer?.reviewedBy ?? "", new Date().toISOString()]],
    },
  ];
  if (reviewer?.note) {
    data.push({
      range: `'${tabName}'!${noteLetter}${rowNumber}`,
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
 * when a generated เอกสารรับเงิน PDF is linked back to the expense row it
 * was created for. `tabName` identifies which month tab the row lives in.
 */
export async function updateExpenseRowReceiptDocLink(
  accessToken: string,
  sheetId: string,
  tabName: string,
  rowId: string,
  link: string
): Promise<void> {
  const sheets = sheetsClient(accessToken);
  const rowNumber = await findRowNumberById(sheets, sheetId, tabName, rowId);
  if (rowNumber === null) {
    throw new Error(`ไม่พบรายการที่รหัส "${rowId}" ในชีท`);
  }

  const linkLetter = columnIndexToLetter(COLUMN_INDEX.receiptDocLink);
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${tabName}'!${linkLetter}${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[link]] },
  });
}

/**
 * Marks a "เงินทดรองจ่าย" row as repaid (or not), matched by "รหัสรายการ"
 * (same find-by-id pattern as updateExpenseRowStatus). `tabName` identifies
 * which month tab the row lives in.
 */
export async function updateExpenseRowRepaymentStatus(
  accessToken: string,
  sheetId: string,
  tabName: string,
  rowId: string,
  repaymentStatus: RepaymentStatus
): Promise<void> {
  const sheets = sheetsClient(accessToken);
  const rowNumber = await findRowNumberById(sheets, sheetId, tabName, rowId);
  if (rowNumber === null) {
    throw new Error(`ไม่พบรายการที่รหัส "${rowId}" ในชีท`);
  }

  await ensureRepaymentStatusHeader(sheets, sheetId, tabName);

  const letter = columnIndexToLetter(COLUMN_INDEX.repaymentStatus);
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${tabName}'!${letter}${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[repaymentStatus]] },
  });
}

/**
 * A flat key -> Drive folder ID lookup, stored as plain rows in a dedicated
 * sheet tab. This exists to work around the app's `drive.file` OAuth scope:
 * that scope only lets a signed-in user's session see/query Drive files and
 * folders it itself created (or the user explicitly opened with it) — a
 * folder one teammate's session created is INVISIBLE to another teammate's
 * session under the same scope, even though both are members of the same
 * team and share the same Drive root folder. The net effect, before this
 * registry existed, was every team member's first upload of the month (or
 * first bug-report screenshot, etc.) silently creating its OWN duplicate
 * folder, since each session's "does this folder already exist?" query came
 * back empty.
 *
 * The Sheets API's `spreadsheets` scope has no such per-session isolation —
 * any user who has been granted access to the spreadsheet can read/write
 * any of its cells, regardless of who created the spreadsheet or wrote to
 * it previously. So the FIRST session that resolves a given folder key
 * creates the Drive folder as before and records its ID here; every
 * subsequent session (any teammate, any month) just reads the ID straight
 * from this tab and skips the Drive-side folder search entirely — no
 * scope-limited query involved, so no more duplicate folders.
 */
const DRIVE_FOLDER_REGISTRY_TAB = "_DriveFolders";

async function ensureDriveFolderRegistryTab(sheets: sheets_v4.Sheets, sheetId: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets.properties(title)",
  });
  const exists = (meta.data.sheets ?? []).some((s) => s.properties?.title === DRIVE_FOLDER_REGISTRY_TAB);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: DRIVE_FOLDER_REGISTRY_TAB, hidden: true } } }],
    },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${DRIVE_FOLDER_REGISTRY_TAB}'!A1:B1`,
    valueInputOption: "RAW",
    requestBody: { values: [["folderKey", "driveFolderId"]] },
  });
}

/** Looks up a previously-registered Drive folder ID for `folderKey`. Returns null if never registered. */
export async function getDriveFolderId(
  accessToken: string,
  sheetId: string,
  folderKey: string
): Promise<string | null> {
  const sheets = sheetsClient(accessToken);
  await ensureDriveFolderRegistryTab(sheets, sheetId);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${DRIVE_FOLDER_REGISTRY_TAB}'!A2:B`,
  });
  const rows = res.data.values ?? [];
  const match = rows.find((r) => r && r[0] === folderKey);
  return match?.[1] ? String(match[1]) : null;
}

/** Registers `folderId` as the Drive folder for `folderKey`, so every other session reuses it. */
export async function setDriveFolderId(
  accessToken: string,
  sheetId: string,
  folderKey: string,
  folderId: string
): Promise<void> {
  const sheets = sheetsClient(accessToken);
  await ensureDriveFolderRegistryTab(sheets, sheetId);

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `'${DRIVE_FOLDER_REGISTRY_TAB}'!A:B`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[folderKey, folderId]] },
  });
}
