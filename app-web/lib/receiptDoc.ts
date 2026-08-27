/**
 * Server-side generator for the "เอกสารรับเงิน" (cash-receipt attestation)
 * PDF, used when an employee's bill has no proper receipt (e.g. a
 * 7-Eleven purchase with no tax invoice) — see docs/02-requirements-from-pop.md
 * ("กรณีบิลไม่สมบูรณ์").
 *
 * This used to generate a .docx via the `docx` package. Switched to a
 * hand-drawn PDF (pdfkit) instead, after repeated rounds of .docx table
 * layouts rendering correctly everywhere they were actually tested (Word,
 * WPS, a direct download, even a fully-converted native Google Doc) yet
 * still garbling in Google Drive's mobile quick-preview app — the surface
 * ~90% of real usage happens on. A .docx's layout is re-computed by
 * whichever app opens it, so it only ever renders as well as that app's own
 * (sometimes buggy) layout/shaping engine. A PDF has its glyphs positioned
 * once, at generation time, and carries that positioning with it — nothing
 * left for a weaker viewer to get wrong. Verified locally by rasterizing a
 * generated PDF and inspecting it directly: Thai combining marks (สระ/
 * วรรณยุกต์, above AND below the base consonant) position correctly at
 * both regular and bold weight.
 *
 * The embedded font is Google Fonts' "Sarabun" (SIL Open Font License,
 * assets/fonts/Sarabun-{Regular,Bold}.ttf) rather than "TH Sarabun New" —
 * a .docx could just reference a font by name and rely on the viewer
 * having it installed, but a PDF must embed the actual font file to
 * guarantee identical rendering everywhere, and TH Sarabun New isn't
 * freely redistributable in the same way. Sarabun is Google's own take on
 * the same loopless-Thai-business-document genre and is visually close.
 */
import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { numberToThaiBahtText } from "./thaiBahtText";

const FONT_REGULAR = "Sarabun";
const FONT_BOLD = "Sarabun-Bold";
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

// A4 in points (72pt/inch), ~2cm margins — plenty of room for this
// document's content, and comfortably printable.
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = "#111111";
const MUTED = "#555555";
const RULE = "#222222";
const DASH_BORDER = "#999999";

const LOGO_PATH = path.join(process.cwd(), "assets", "tdfb-logo.jpg");
let logoBuffer: Buffer | null = null;
try {
  logoBuffer = fs.readFileSync(LOGO_PATH);
} catch {
  logoBuffer = null;
}

interface Run {
  text: string;
  font?: string;
  size?: number;
  color?: string;
  underline?: boolean;
}

function r(text: string, opts: Partial<Omit<Run, "text">> = {}): Run {
  return { text, font: FONT_REGULAR, size: 11, color: INK, ...opts };
}

/**
 * Draws a single line built from mixed-style runs (like a .docx paragraph
 * of TextRuns), left/center/right aligned within [x, x + width] at y.
 * Handles per-run underlines manually (pdfkit's `underline` option only
 * cooperates with its own text-flow calls, not with hand-positioned runs).
 * Returns the line's height so callers can advance their own y cursor.
 */
function drawRuns(
  doc: PDFKit.PDFDocument,
  runs: Run[],
  x: number,
  y: number,
  width: number,
  align: "left" | "center" | "right" = "left"
): number {
  const widths = runs.map((run) => {
    doc.font(run.font ?? FONT_REGULAR).fontSize(run.size ?? 11);
    return doc.widthOfString(run.text);
  });
  const totalWidth = widths.reduce((a, b) => a + b, 0);
  const maxSize = Math.max(...runs.map((run) => run.size ?? 11), 11);

  let cursorX = x;
  if (align === "center") cursorX = x + (width - totalWidth) / 2;
  if (align === "right") cursorX = x + width - totalWidth;

  runs.forEach((run, i) => {
    doc
      .font(run.font ?? FONT_REGULAR)
      .fontSize(run.size ?? 11)
      .fillColor(run.color ?? INK)
      .text(run.text, cursorX, y, { lineBreak: false });
    if (run.underline) {
      const lineY = y + (run.size ?? 11) + 2;
      doc
        .save()
        .strokeColor(run.color ?? INK)
        .lineWidth(0.7)
        .moveTo(cursorX, lineY)
        .lineTo(cursorX + widths[i], lineY)
        .stroke()
        .restore();
    }
    cursorX += widths[i];
  });

  doc.fillColor(INK);
  return maxSize * 1.35;
}

/** Draws a dashed-border rectangle (the ID-photo placeholder box). */
function drawDashedBox(doc: PDFKit.PDFDocument, x: number, y: number, width: number, height: number) {
  doc
    .save()
    .strokeColor(DASH_BORDER)
    .lineWidth(1)
    .dash(3, { space: 2 })
    .rect(x, y, width, height)
    .stroke()
    .undash()
    .restore();
}

/**
 * Draws `text` wrapped within `width`, every line underlined — used for the
 * filled-in "รายละเอียด" block, which can be several OCR-extracted line
 * items (already \n-separated) or a single long line needing to wrap.
 * Returns the total height consumed.
 */
function drawUnderlinedBlock(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
  size = 11
): number {
  doc.font(FONT_REGULAR).fontSize(size).fillColor(INK);
  const startY = doc.y;
  doc.text(text, x, y, { width, underline: true, lineGap: 3 });
  const consumed = doc.y - y;
  doc.y = startY; // caller manages its own cursor
  return consumed || size * 1.35;
}

export interface GenerateReceiptDocInput {
  /** ชื่อผู้รับเงิน */
  payeeName: string;
  /** เลขประจำตัวประชาชน */
  idNumber: string;
  /** ได้รับเงินจากบริษัทเป็นค่า... */
  expenseDetail: string;
  /** จำนวนเงิน (baht) */
  amountNumber: number;
  /** วันที่ในเอกสาร, e.g. "26 สิงหาคม 2569" (already formatted Thai text) */
  docDate: string;
  /** รูปสำเนาบัตรประชาชน — omit to leave a placeholder box. pdfkit detects
   * JPEG vs PNG from the buffer's own signature, so no MIME type is needed. */
  idCardImageBuffer?: Buffer;
}

/** Builds the filled-in "เอกสารรับเงิน" PDF and returns it as a Buffer. */
export async function generateReceiptDoc(data: GenerateReceiptDocInput): Promise<Buffer> {
  const amountText = numberToThaiBahtText(data.amountNumber);
  const amountNumberText = data.amountNumber.toFixed(2);

  const doc = new PDFDocument({
    size: [PAGE_WIDTH, PAGE_HEIGHT],
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  doc.registerFont(FONT_REGULAR, path.join(FONT_DIR, "Sarabun-Regular.ttf"));
  doc.registerFont(FONT_BOLD, path.join(FONT_DIR, "Sarabun-Bold.ttf"));

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  // ---- Header: logo + right-aligned company info ----
  const LOGO_SIZE = 54;
  const HEADER_GAP = 14;
  const headerTop = doc.y;
  if (logoBuffer) {
    doc.image(logoBuffer, MARGIN, headerTop, { width: LOGO_SIZE, height: LOGO_SIZE });
  } else {
    drawDashedBox(doc, MARGIN, headerTop, LOGO_SIZE, LOGO_SIZE);
    drawRuns(doc, [r("TDFB", { font: FONT_BOLD, size: 10, color: MUTED })], MARGIN, headerTop + LOGO_SIZE / 2 - 5, LOGO_SIZE, "center");
  }

  const infoX = MARGIN + LOGO_SIZE + HEADER_GAP;
  const infoWidth = CONTENT_WIDTH - LOGO_SIZE - HEADER_GAP;
  let infoY = headerTop;
  infoY += drawRuns(doc, [r("บริษัท ทีดี ฟู้ดแอนด์เบเวอร์เรจ จำกัด", { font: FONT_BOLD, size: 15 })], infoX, infoY, infoWidth, "right") - 3;
  infoY += drawRuns(
    doc,
    [r("300 ถนนประชาอุทิศ แขวงทุ่งครุ เขตทุ่งครุ กรุงเทพมหานคร 10140", { size: 10, color: MUTED })],
    infoX,
    infoY,
    infoWidth,
    "right"
  ) - 3;
  drawRuns(doc, [r("โทร 096-009-3570", { size: 10, color: MUTED })], infoX, infoY, infoWidth, "right");

  doc.y = headerTop + Math.max(LOGO_SIZE, 15 + 10 + 10 + 20) + 14;

  // ---- Rule line ----
  doc.save().strokeColor(RULE).lineWidth(1.2).moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_WIDTH, doc.y).stroke().restore();
  doc.y += 22;

  // ---- Title ----
  drawRuns(doc, [r("เอกสารการรับเงิน", { font: FONT_BOLD, size: 18 })], MARGIN, doc.y, CONTENT_WIDTH, "center");
  doc.y += 18 * 1.35 + 18;

  // ---- Date ----
  drawRuns(
    doc,
    [r("วันที่ "), r(data.docDate, { font: FONT_BOLD, underline: true })],
    MARGIN,
    doc.y,
    CONTENT_WIDTH,
    "right"
  );
  doc.y += 11 * 1.35 + 20;

  // ---- Body ----
  doc.y += drawRuns(
    doc,
    [
      r("ข้าพเจ้า "),
      r(data.payeeName, { underline: true }),
      r("     เลขประจำตัวประชาชน "),
      r(data.idNumber, { underline: true }),
    ],
    MARGIN,
    doc.y,
    CONTENT_WIDTH,
    "left"
  ) + 12;

  drawRuns(
    doc,
    [r("ได้รับเงินจาก บริษัท ทีดี ฟู้ดแอนด์เบเวอร์เรจ จำกัด เป็นค่า")],
    MARGIN,
    doc.y,
    CONTENT_WIDTH,
    "left"
  );
  doc.y += 11 * 1.35 + 4;
  doc.y += drawUnderlinedBlock(doc, data.expenseDetail, MARGIN + 16, doc.y, CONTENT_WIDTH - 16) + 12;

  doc.y += drawRuns(
    doc,
    [
      r("เป็นจำนวนเงิน "),
      r(amountNumberText, { font: FONT_BOLD, underline: true }),
      r(` บาท (${amountText})`, { underline: true }),
    ],
    MARGIN,
    doc.y,
    CONTENT_WIDTH,
    "left"
  ) + 22;

  // ---- Attachments ----
  drawRuns(doc, [r("เอกสารแนบ", { font: FONT_BOLD, size: 13 })], MARGIN, doc.y, CONTENT_WIDTH, "left");
  doc.y += 13 * 1.35 + 10;
  for (const line of [
    "1. ใบเบิกทดรองจ่าย / ใบรับรองแทนใบเสร็จรับเงิน",
    "2. เอกสารการรับเงิน",
    "3. ใบเสร็จ / ใบกำกับภาษี",
  ]) {
    drawRuns(doc, [r(line)], MARGIN, doc.y, CONTENT_WIDTH, "left");
    doc.y += 11 * 1.35 + 6;
  }
  doc.y += 18;

  // ---- Footer: ID photo (left) + signature (right) ----
  const FOOTER_HEIGHT = 170;
  if (doc.y + FOOTER_HEIGHT > PAGE_HEIGHT - MARGIN) {
    doc.addPage();
  }
  const footerTop = doc.y;
  const PHOTO_COL_WIDTH = CONTENT_WIDTH * 0.42;
  const SIGN_COL_WIDTH = CONTENT_WIDTH - PHOTO_COL_WIDTH;
  const signX = MARGIN + PHOTO_COL_WIDTH;

  let photoY = footerTop;
  photoY += drawRuns(doc, [r("รูปภาพสำเนาบัตรประชาชน", { size: 10 })], MARGIN, photoY, PHOTO_COL_WIDTH, "center") + 8;
  const PHOTO_BOX_WIDTH = PHOTO_COL_WIDTH - 20;
  const PHOTO_BOX_HEIGHT = 110;
  const photoBoxX = MARGIN + (PHOTO_COL_WIDTH - PHOTO_BOX_WIDTH) / 2;
  if (data.idCardImageBuffer) {
    doc.image(data.idCardImageBuffer, photoBoxX, photoY, {
      fit: [PHOTO_BOX_WIDTH, PHOTO_BOX_HEIGHT],
      align: "center",
      valign: "center",
    });
  } else {
    drawDashedBox(doc, photoBoxX, photoY, PHOTO_BOX_WIDTH, PHOTO_BOX_HEIGHT);
  }

  let signY = footerTop;
  signY +=
    (() => {
      doc.font(FONT_REGULAR).fontSize(11).fillColor(INK);
      const startY = signY;
      doc.text("รับรองถูกต้องและได้รับเงินครบถ้วนตามจำนวนดังกล่าว", signX, signY, {
        width: SIGN_COL_WIDTH,
        align: "center",
      });
      return doc.y - startY;
    })() + 30;

  drawRuns(doc, [r("ลงชื่อ "), r(" ".repeat(28), { underline: true })], signX, signY, SIGN_COL_WIDTH, "center");
  signY += 11 * 1.35 + 8;
  drawRuns(doc, [r(`(${data.payeeName})`, { font: FONT_BOLD })], signX, signY, SIGN_COL_WIDTH, "center");

  doc.end();
  return done;
}
