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

// Manual underlines are drawn at `y + size * UNDERLINE_DROP` (y being the
// TOP of the text box, not the baseline). Thai vowels/consonants can dip
// below the baseline (e.g. ญ, ฎ, ฏ, สระอุ/อู), so this needs real clearance
// below the glyphs — a flat "+2" was tight enough at BODY_SIZE to go
// unnoticed but visibly clipped descenders once fields were sized up to
// FIELD_SIZE.
const UNDERLINE_DROP = 1.28;

// Font sizes, all two points smaller than the first cut — printed/downloaded
// full-size read as too large.
const TITLE_SIZE = 16;
const HEADER_NAME_SIZE = 13;
const HEADER_SMALL_SIZE = 8;
const BODY_SIZE = 9;
const SECTION_HEAD_SIZE = 11;
// The filled-in identity/amount fields (name, ID number, expense detail,
// amount) read as the actual content of the document, so they're sized up
// from BODY_SIZE for legibility — everything else (attachments list,
// footer captions) stays at BODY_SIZE.
const FIELD_SIZE = 12;

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
  return { text, font: FONT_REGULAR, size: BODY_SIZE, color: INK, ...opts };
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
    doc.font(run.font ?? FONT_REGULAR).fontSize(run.size ?? BODY_SIZE);
    return doc.widthOfString(run.text);
  });
  const totalWidth = widths.reduce((a, b) => a + b, 0);
  const maxSize = Math.max(...runs.map((run) => run.size ?? BODY_SIZE), BODY_SIZE);

  let cursorX = x;
  if (align === "center") cursorX = x + (width - totalWidth) / 2;
  if (align === "right") cursorX = x + width - totalWidth;

  runs.forEach((run, i) => {
    doc
      .font(run.font ?? FONT_REGULAR)
      .fontSize(run.size ?? BODY_SIZE)
      .fillColor(run.color ?? INK)
      .text(run.text, cursorX, y, { lineBreak: false });
    if (run.underline) {
      const lineY = y + (run.size ?? BODY_SIZE) * UNDERLINE_DROP;
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
 * Draws "label value" where the value sits in an underlined slot of a FIXED
 * width (not just as wide as the value text) — a short value still fills
 * its slot instead of leaving the rest of the row blank. Returns the total
 * width consumed (label + slot), so callers can chain fields on one row.
 */
function drawFilledField(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  x: number,
  y: number,
  slotWidth: number,
  size = BODY_SIZE
): number {
  doc.font(FONT_REGULAR).fontSize(size).fillColor(INK);
  doc.text(label, x, y, { lineBreak: false });
  const labelWidth = doc.widthOfString(label);
  const valueX = x + labelWidth;
  doc.text(value, valueX, y, { lineBreak: false });
  const lineY = y + size * UNDERLINE_DROP;
  doc
    .save()
    .strokeColor(INK)
    .lineWidth(0.7)
    .moveTo(valueX, lineY)
    .lineTo(x + labelWidth + slotWidth, lineY)
    .stroke()
    .restore();
  return labelWidth + slotWidth;
}

/**
 * Draws `label` (plain, static instructional text — assumed to fit on one
 * line) immediately followed by `value`, word-wrapped across the remaining
 * width and continuing on full-width lines below as needed, with a
 * full-width underline under every line of `value` reaching the right
 * margin — not just as far as the typed text — matching every other
 * filled-in field in the document (name, ID number, amount). Manual
 * word-wrap (rather than pdfkit's own continued-text flow) is what makes
 * that fill-to-margin underline possible here. Returns the height consumed.
 */
function drawFilledParagraph(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  size = BODY_SIZE
): number {
  doc.font(FONT_REGULAR).fontSize(size).fillColor(INK);
  doc.text(label, x, y, { lineBreak: false });
  const labelWidth = doc.widthOfString(label);

  // The first line has less room than the rest (it shares its width with
  // the label). A word that doesn't fit there must fall through to a
  // fresh, full-width line — NOT get force-placed into the narrow first
  // line regardless of fit, which is what let a long unbroken run of Thai
  // text overflow past the right margin when the label itself was already
  // long (e.g. "ได้รับเงินจาก บริษัท ทีดี ฟู้ดแอนด์เบเวอร์เรจ จำกัด เป็นค่า").
  const words = value.split(" ");
  const lines: string[] = [];
  let current = "";
  let budget = width - labelWidth;
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (doc.widthOfString(candidate) <= budget) {
      current = candidate;
      continue;
    }
    // Doesn't fit what's left of the current line — close it out (even if
    // that leaves an empty first line, when the label alone filled it) and
    // continue the word on a fresh, full-width line.
    lines.push(current);
    current = word;
    budget = width;
  }
  lines.push(current);

  const lineHeight = size * 1.35;
  doc.save().strokeColor(INK).lineWidth(0.7);
  lines.forEach((line, i) => {
    const lineX = i === 0 ? x + labelWidth : x;
    const lineTopY = y + i * lineHeight;
    doc.fillColor(INK).text(line, lineX, lineTopY, { lineBreak: false });
    const underlineY = lineTopY + size * UNDERLINE_DROP;
    doc.moveTo(lineX, underlineY).lineTo(x + width, underlineY).stroke();
  });
  doc.restore();

  return lines.length * lineHeight;
}

/**
 * Draws the "เป็นจำนวนเงิน [number] บาท ([spelled out])" line with a single
 * underline running from right after the label all the way to the right
 * margin (`x + width`), rather than one underline per run — so a small
 * amount (short digits, short spelled-out text) still reaches the edge of
 * the row instead of stopping right after the text. Returns the line height.
 */
function drawAmountLine(
  doc: PDFKit.PDFDocument,
  amountNumberText: string,
  amountText: string,
  x: number,
  y: number,
  width: number,
  size = BODY_SIZE
): number {
  doc.font(FONT_REGULAR).fontSize(size).fillColor(INK);
  const label = "เป็นจำนวนเงิน ";
  doc.text(label, x, y, { lineBreak: false });
  const labelWidth = doc.widthOfString(label);
  const valueX = x + labelWidth;

  doc.font(FONT_BOLD).fontSize(size);
  doc.text(amountNumberText, valueX, y, { lineBreak: false });
  const numberWidth = doc.widthOfString(amountNumberText);

  doc.font(FONT_REGULAR).fontSize(size);
  doc.text(` บาท (${amountText})`, valueX + numberWidth, y, { lineBreak: false });

  const lineY = y + size * UNDERLINE_DROP;
  doc
    .save()
    .strokeColor(INK)
    .lineWidth(0.7)
    .moveTo(valueX, lineY)
    .lineTo(x + width, lineY)
    .stroke()
    .restore();

  doc.fillColor(INK);
  return size * 1.35;
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
    drawRuns(
      doc,
      [r("TDFB", { font: FONT_BOLD, size: HEADER_SMALL_SIZE, color: MUTED })],
      MARGIN,
      headerTop + LOGO_SIZE / 2 - 5,
      LOGO_SIZE,
      "center"
    );
  }

  const infoX = MARGIN + LOGO_SIZE + HEADER_GAP;
  const infoWidth = CONTENT_WIDTH - LOGO_SIZE - HEADER_GAP;
  let infoY = headerTop;
  infoY +=
    drawRuns(
      doc,
      [r("บริษัท ทีดี ฟู้ดแอนด์เบเวอร์เรจ จำกัด", { font: FONT_BOLD, size: HEADER_NAME_SIZE })],
      infoX,
      infoY,
      infoWidth,
      "right"
    ) - 1;
  // Address wraps across two lines, with the phone number tacked onto the
  // end of the second — three header lines total either way, just a
  // narrower/taller block instead of one very long address line. No gap
  // trimmed between these two (unlike above): Thai vowel/tone marks stack
  // both above and below the base consonant, so an 8pt line needs its full
  // height or the next line's marks start touching this one's.
  infoY += drawRuns(
    doc,
    [r("300 ถนนประชาอุทิศ แขวงทุ่งครุ เขตทุ่งครุ", { size: HEADER_SMALL_SIZE, color: MUTED })],
    infoX,
    infoY,
    infoWidth,
    "right"
  );
  drawRuns(
    doc,
    [r("กรุงเทพมหานคร 10140 โทร 02-114-3715", { size: HEADER_SMALL_SIZE, color: MUTED })],
    infoX,
    infoY,
    infoWidth,
    "right"
  );

  doc.y = headerTop + Math.max(LOGO_SIZE, HEADER_NAME_SIZE + HEADER_SMALL_SIZE * 2 + 16) + 14;

  // ---- Rule line ----
  doc.save().strokeColor(RULE).lineWidth(1.2).moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_WIDTH, doc.y).stroke().restore();
  doc.y += 22;

  // ---- Title ----
  drawRuns(doc, [r("เอกสารการรับเงิน", { font: FONT_BOLD, size: TITLE_SIZE })], MARGIN, doc.y, CONTENT_WIDTH, "center");
  doc.y += TITLE_SIZE * 1.35 + 18;

  // ---- Date ----
  drawRuns(
    doc,
    [r("วันที่ "), r(data.docDate, { font: FONT_BOLD, underline: true })],
    MARGIN,
    doc.y,
    CONTENT_WIDTH,
    "right"
  );
  doc.y += BODY_SIZE * 1.35 + 20;

  // ---- Body ----
  // Name and ID number share one row when they comfortably fit — the name
  // gets just enough slot width for its own value, ID number gets the rest
  // out to the right margin. A long payee name falls back to its own
  // full-width row instead, so it can never run into the ID field next to
  // it (names vary a lot in length; a fixed split isn't safe).
  {
    doc.font(FONT_REGULAR).fontSize(FIELD_SIZE);
    const nameLabel = "ข้าพเจ้า ";
    const idLabelInline = "   เลขประจำตัวประชาชน ";
    const nameLabelWidth = doc.widthOfString(nameLabel);
    const nameValueWidth = doc.widthOfString(data.payeeName);
    const idLabelInlineWidth = doc.widthOfString(idLabelInline);
    const idValueWidth = doc.widthOfString(data.idNumber);
    const oneLineWidth = nameLabelWidth + nameValueWidth + idLabelInlineWidth + idValueWidth;

    const rowY1 = doc.y;
    if (oneLineWidth <= CONTENT_WIDTH - 20) {
      const nameSlotWidth = nameValueWidth + 24;
      const afterName = drawFilledField(doc, nameLabel, data.payeeName, MARGIN, rowY1, nameSlotWidth, FIELD_SIZE);
      const idSlotWidth = CONTENT_WIDTH - afterName - idLabelInlineWidth;
      drawFilledField(doc, idLabelInline, data.idNumber, MARGIN + afterName, rowY1, idSlotWidth, FIELD_SIZE);
      doc.y = rowY1 + FIELD_SIZE * 1.35 + 14;
    } else {
      drawFilledField(doc, nameLabel, data.payeeName, MARGIN, rowY1, CONTENT_WIDTH - nameLabelWidth, FIELD_SIZE);
      const rowY2 = rowY1 + FIELD_SIZE * 1.35 + 10;
      const idLabel = "เลขประจำตัวประชาชน ";
      doc.font(FONT_REGULAR).fontSize(FIELD_SIZE);
      const idLabelWidth = doc.widthOfString(idLabel);
      drawFilledField(doc, idLabel, data.idNumber, MARGIN, rowY2, CONTENT_WIDTH - idLabelWidth, FIELD_SIZE);
      doc.y = rowY2 + FIELD_SIZE * 1.35 + 14;
    }
  }

  // "ได้รับเงินจาก...เป็นค่า" flows directly into the filled-in expense
  // detail on the same line, wrapping automatically as a single paragraph —
  // rather than a separate indented block below — with the filled-in part
  // underlined all the way to the right margin on every line, same as the
  // other filled-in fields.
  //
  // The label already ends in "เป็นค่า" — OCR-extracted details commonly
  // start with "ค่า..." too (e.g. "ค่าเดินทางและค่าจอดรถ"), which read as
  // "เป็นค่า ค่าเดินทาง..." if left as-is. Strip one leading "ค่า" so the
  // sentence doesn't repeat it; only the very start, so "ค่าจอดรถ" later in
  // the same string is untouched.
  const expenseDetailForSentence = data.expenseDetail.replace(/^ค่า\s*/, "");
  doc.y += drawFilledParagraph(
    doc,
    "ได้รับเงินจาก บริษัท ทีดี ฟู้ดแอนด์เบเวอร์เรจ จำกัด เป็นค่า ",
    expenseDetailForSentence,
    MARGIN,
    doc.y,
    CONTENT_WIDTH,
    FIELD_SIZE
  ) + 16;

  doc.y += drawAmountLine(doc, amountNumberText, amountText, MARGIN, doc.y, CONTENT_WIDTH, FIELD_SIZE) + 22;

  // ---- Attachments ----
  drawRuns(doc, [r("เอกสารแนบ", { font: FONT_BOLD, size: SECTION_HEAD_SIZE })], MARGIN, doc.y, CONTENT_WIDTH, "left");
  doc.y += SECTION_HEAD_SIZE * 1.35 + 10;
  for (const line of [
    "1. ใบเบิกทดรองจ่าย / ใบรับรองแทนใบเสร็จรับเงิน",
    "2. เอกสารการรับเงิน",
    "3. ใบเสร็จ / ใบกำกับภาษี",
  ]) {
    drawRuns(doc, [r(line)], MARGIN, doc.y, CONTENT_WIDTH, "left");
    doc.y += BODY_SIZE * 1.35 + 6;
  }
  doc.y += 18;

  // ---- Footer: ID photo (left) + signature (right) ----
  const FOOTER_HEIGHT = 185;
  if (doc.y + FOOTER_HEIGHT > PAGE_HEIGHT - MARGIN) {
    doc.addPage();
  }
  const footerTop = doc.y;
  const PHOTO_COL_WIDTH = CONTENT_WIDTH * 0.42;
  const SIGN_COL_WIDTH = CONTENT_WIDTH - PHOTO_COL_WIDTH;
  const signX = MARGIN + PHOTO_COL_WIDTH;

  let photoY = footerTop;
  photoY +=
    drawRuns(doc, [r("รูปภาพสำเนาบัตรประชาชน", { size: HEADER_SMALL_SIZE })], MARGIN, photoY, PHOTO_COL_WIDTH, "center") + 8;
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
      doc.font(FONT_REGULAR).fontSize(BODY_SIZE).fillColor(INK);
      const startY = signY;
      doc.text("รับรองถูกต้องและได้รับเงินครบถ้วนตามจำนวนดังกล่าว", signX, signY, {
        width: SIGN_COL_WIDTH,
        align: "center",
      });
      return doc.y - startY;
    })() +
    30 +
    // One extra blank line's worth of space right above "ลงชื่อ", so there's
    // real room to sign by hand once this is printed, not just a cramped line.
    BODY_SIZE * 1.35;

  // The "ลงชื่อ ____" block (label + line) is centered as a unit within the
  // column, same as the "(name)" line below it — a fixed-length line still
  // leaves real room to sign, it just no longer sits flush against the
  // left edge looking disconnected from the rest of the block.
  const SIGN_LABEL = "ลงชื่อ ";
  const SIGN_LINE_LENGTH = 150;
  doc.font(FONT_REGULAR).fontSize(BODY_SIZE).fillColor(INK);
  const signLabelWidth = doc.widthOfString(SIGN_LABEL);
  const signBlockWidth = signLabelWidth + SIGN_LINE_LENGTH;
  const signBlockX = signX + (SIGN_COL_WIDTH - signBlockWidth) / 2;
  doc.text(SIGN_LABEL, signBlockX, signY, { lineBreak: false });
  const signLineY = signY + BODY_SIZE + 2;
  doc
    .save()
    .strokeColor(INK)
    .lineWidth(0.7)
    .moveTo(signBlockX + signLabelWidth, signLineY)
    .lineTo(signBlockX + signBlockWidth, signLineY)
    .stroke()
    .restore();

  signY += BODY_SIZE * 1.35 + 8;
  drawRuns(doc, [r(`(${data.payeeName})`, { font: FONT_BOLD })], signX, signY, SIGN_COL_WIDTH, "center");

  doc.end();
  return done;
}
