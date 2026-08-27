import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTeamByKey } from "@/lib/teams";
import { generateReceiptDoc } from "@/lib/receiptDoc";
import { formatThaiBuddhistDate, formatYyyymmdd } from "@/lib/thaiDate";
import { uploadReceiptFile } from "@/lib/drive";
import { updateExpenseRowReceiptDocLink } from "@/lib/sheets";

// Dedicated Drive subfolder (under the team's driveRootFolderId) that every
// generated เอกสารรับเงิน gets uploaded into, so it can be found again later.
const RECEIPT_DOC_DRIVE_FOLDER = "เอกสารรับเงิน";

function sanitizeForFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_").trim() || "receipt-doc";
}

/**
 * POST /api/receipt-doc — accepts multipart form data (payee info + an
 * optional ID card image, plus an optional `expenseRowId` to link back to)
 * and returns the filled "เอกสารรับเงิน" PDF as a file download.
 *
 * Additive on top of that: the generated PDF is also uploaded to Drive
 * (see RECEIPT_DOC_DRIVE_FOLDER) and, if both an expenseRowId AND a
 * monthTab (the row's month tab name, since sheet writes now need to know
 * which month tab to target and this route cannot guess it) were given, its
 * link is written into that row's "ลิงก์เอกสารรับเงิน" column. If monthTab is
 * missing, the sheet link-back step is skipped (logged, non-fatal). Both
 * happen after the buffer is generated and neither can fail the file
 * download — Drive upload / sheet errors are logged and surfaced via
 * response headers only (`X-Drive-Web-View-Link`, `X-Linked-Expense-Id`),
 * never a failed response.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const payeeName = ((formData.get("payeeName") as string) || session.user?.name || "").trim();
  const idNumber = ((formData.get("idNumber") as string) || "").trim();
  const expenseDetail = ((formData.get("expenseDetail") as string) || "").trim();
  const amountNumber = Number(formData.get("amountNumber") ?? NaN);
  const now = new Date();
  const docDate = ((formData.get("docDate") as string) || "").trim() || formatThaiBuddhistDate(now);
  const expenseRowId = ((formData.get("expenseRowId") as string) || "").trim();
  const monthTab = ((formData.get("monthTab") as string) || "").trim();

  if (!payeeName || !idNumber || !expenseDetail || !Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "กรอกข้อมูลให้ครบ: ชื่อผู้รับเงิน, เลขบัตรประชาชน, รายละเอียด, จำนวนเงิน" }, { status: 400 });
  }

  let idCardImageBuffer: Buffer | undefined;
  const idCardImage = formData.get("idCardImage");
  if (idCardImage instanceof File && idCardImage.size > 0) {
    idCardImageBuffer = Buffer.from(await idCardImage.arrayBuffer());
  }

  try {
    const buffer = await generateReceiptDoc({
      payeeName,
      idNumber,
      expenseDetail,
      amountNumber,
      docDate,
      idCardImageBuffer,
    });

    const docDateCompact = formatYyyymmdd(now);
    const headers: Record<string, string> = {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="receipt-doc-${docDateCompact}.pdf"`,
      // docDate defaults server-side (today's date) when the form doesn't
      // send one — the client needs the resolved value to name the
      // downloaded file consistently with what's printed in the document.
      // Header values must be ISO-8859-1, so the Thai text is percent-encoded.
      "X-Doc-Date": encodeURIComponent(docDate),
      // Machine-readable companion for the filename (YYYYMMDD) — avoids the
      // client having to parse the Thai-formatted X-Doc-Date text back apart.
      "X-Doc-Date-Compact": docDateCompact,
    };

    // Uploading to Drive (and linking to a sheet row) is additive — if any
    // part of it fails, the PDF download above must still succeed exactly
    // as it did before this feature existed.
    try {
      const team = getTeamByKey(session.team?.key);
      if (team?.driveRootFolderId && team?.sheetId && session.accessToken) {
        const uploaded = await uploadReceiptFile(
          session.accessToken,
          team.sheetId,
          team.driveRootFolderId,
          RECEIPT_DOC_DRIVE_FOLDER,
          {
            buffer,
            mimeType: "application/pdf",
          },
          `receipt-doc-${sanitizeForFilename(payeeName)}-${docDateCompact}.pdf`
        );
        headers["X-Drive-Web-View-Link"] = uploaded.webViewLink;

        if (expenseRowId && team.sheetId) {
          if (monthTab) {
            await updateExpenseRowReceiptDocLink(
              session.accessToken,
              team.sheetId,
              monthTab,
              expenseRowId,
              uploaded.webViewLink
            );
            headers["X-Linked-Expense-Id"] = expenseRowId;
          } else {
            console.error("POST /api/receipt-doc: no monthTab provided, skipping sheet link-back");
          }
        }
      }
    } catch (uploadErr) {
      console.error("POST /api/receipt-doc: Drive upload/link failed (non-fatal, download still proceeds)", uploadErr);
      // Surfaced as a header (not a failed response — the download must still
      // succeed) so a silent Drive-side failure is visible to the client
      // instead of only ever showing up in server logs nobody's watching.
      headers["X-Drive-Upload-Error"] = encodeURIComponent(
        uploadErr instanceof Error ? uploadErr.message : "unknown error"
      );
    }

    return new NextResponse(new Uint8Array(buffer), { status: 200, headers });
  } catch (err) {
    console.error("POST /api/receipt-doc failed", err);
    return NextResponse.json({ error: "สร้างเอกสารรับเงินไม่สำเร็จ" }, { status: 500 });
  }
}
