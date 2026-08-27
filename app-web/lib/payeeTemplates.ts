/**
 * Saved ผู้รับเงิน details for the เอกสารรับเงิน form.
 *
 * Creating a receipt document previously meant re-typing the payee's name
 * and their 13-digit national ID, and re-attaching a photo of their ID card,
 * every single time — slow and easy to fat-finger. A template stores those
 * three once so later documents only need the expense description and the
 * amount.
 *
 * Stored in a hidden tab of the team's own sheet (same approach as the Drive
 * folder registry) rather than in the browser, so a template survives
 * clearing site data and is shared by whoever creates documents for the
 * team — an admin often raises these on several people's behalf.
 *
 * The ID card photo itself stays in Drive; only its file id is kept here, so
 * the image is never duplicated into the spreadsheet.
 */
import { google, type sheets_v4 } from "googleapis";

const TEMPLATE_TAB = "_PayeeTemplates";
const HEADERS = ["payeeName", "idNumber", "idCardFileId", "idCardLink", "savedAt", "savedBy"];

export interface PayeeTemplate {
  payeeName: string;
  idNumber: string;
  /** Drive file id of the saved ID-card image; empty when none was attached. */
  idCardFileId: string;
  idCardLink: string;
  savedAt: string;
  savedBy: string;
}

function sheetsClient(accessToken: string): sheets_v4.Sheets {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.sheets({ version: "v4", auth });
}

/** Creates the hidden template tab on first use. No-op once it exists. */
async function ensureTemplateTab(sheets: sheets_v4.Sheets, sheetId: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets.properties(title)",
  });
  if ((meta.data.sheets ?? []).some((s) => s.properties?.title === TEMPLATE_TAB)) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: TEMPLATE_TAB, hidden: true } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${TEMPLATE_TAB}'!A1:F1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADERS] },
  });
}

export async function listPayeeTemplates(accessToken: string, sheetId: string): Promise<PayeeTemplate[]> {
  const sheets = sheetsClient(accessToken);
  await ensureTemplateTab(sheets, sheetId);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${TEMPLATE_TAB}'!A2:F`,
  });
  return (res.data.values ?? [])
    .filter((r) => r && String(r[0] ?? "").trim())
    .map((r) => ({
      payeeName: String(r[0] ?? ""),
      idNumber: String(r[1] ?? ""),
      idCardFileId: String(r[2] ?? ""),
      idCardLink: String(r[3] ?? ""),
      savedAt: String(r[4] ?? ""),
      savedBy: String(r[5] ?? ""),
    }));
}

/**
 * Saves (or replaces) the template for a payee. Keyed on payeeName so
 * re-saving the same person corrects their details in place rather than
 * stacking duplicates in the picker.
 */
export async function savePayeeTemplate(
  accessToken: string,
  sheetId: string,
  template: PayeeTemplate
): Promise<void> {
  const sheets = sheetsClient(accessToken);
  await ensureTemplateTab(sheets, sheetId);

  const existing = await listPayeeTemplates(accessToken, sheetId);
  const index = existing.findIndex((t) => t.payeeName === template.payeeName);
  const values = [[
    template.payeeName,
    template.idNumber,
    template.idCardFileId,
    template.idCardLink,
    template.savedAt,
    template.savedBy,
  ]];

  if (index >= 0) {
    // +2: row 1 is the header, and listPayeeTemplates is 0-based.
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${TEMPLATE_TAB}'!A${index + 2}:F${index + 2}`,
      valueInputOption: "RAW",
      requestBody: { values },
    });
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `'${TEMPLATE_TAB}'!A:F`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

/** Removes a saved payee from the picker. */
export async function deletePayeeTemplate(
  accessToken: string,
  sheetId: string,
  payeeName: string
): Promise<void> {
  const sheets = sheetsClient(accessToken);
  const existing = await listPayeeTemplates(accessToken, sheetId);
  const index = existing.findIndex((t) => t.payeeName === payeeName);
  if (index < 0) return;

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets.properties(title,sheetId)",
  });
  const tab = (meta.data.sheets ?? []).find((s) => s.properties?.title === TEMPLATE_TAB);
  const tabId = tab?.properties?.sheetId;
  if (tabId == null) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: tabId,
              dimension: "ROWS",
              startIndex: index + 1, // skip the header row
              endIndex: index + 2,
            },
          },
        },
      ],
    },
  });
}
