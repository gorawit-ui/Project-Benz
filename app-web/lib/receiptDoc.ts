/**
 * Server-side generator for the "เอกสารรับเงิน" (cash-receipt attestation)
 * .docx, used when an employee's bill has no proper receipt (e.g. a
 * 7-Eleven purchase with no tax invoice) — see docs/02-requirements-from-pop.md
 * ("กรณีบิลไม่สมบูรณ์"). This is a direct TypeScript port of the table/paragraph
 * structure in templates/receipt-doc/build.js, parameterized with real data
 * instead of the original template/{{tag}} + hardcoded sample "filled" modes.
 */
import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
  type ParagraphChild,
} from "docx";
import { numberToThaiBahtText } from "./thaiBahtText";

const FONT = "TH Sarabun New";

function run(text: string, opts: Partial<Omit<IRunOptions, "text">> = {}) {
  return new TextRun({ text, font: FONT, size: 30, ...opts });
}

function para(
  children: ParagraphChild[],
  opts: Partial<Omit<IParagraphOptions, "children">> = {}
) {
  return new Paragraph({ children, spacing: { after: 200, line: 320 }, ...opts });
}

function noBorder() {
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return { top: none, bottom: none, left: none, right: none };
}

function thinBorder() {
  const b = { style: BorderStyle.SINGLE, size: 4, color: "222222" };
  return { top: b, left: b, bottom: b, right: b };
}

function ruleLine() {
  const line = { style: BorderStyle.SINGLE, size: 6, color: "222222" };
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: { top: none, left: none, bottom: line, right: none },
            children: [new Paragraph({ text: "", spacing: { after: 0 } })],
          }),
        ],
      }),
    ],
  });
}

function dashedBorder() {
  const b = { style: BorderStyle.DASHED, size: 4, color: "AAAAAA" };
  return { top: b, left: b, bottom: b, right: b };
}

function dashedBox(cellChildren: Paragraph[], widthPct = 100) {
  return new Table({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: dashedBorder(),
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 120, bottom: 120, left: 120, right: 120 },
            children: cellChildren,
          }),
        ],
      }),
    ],
  });
}

function buildHeaderTable() {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorder(),
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 22, type: WidthType.PERCENTAGE },
            borders: noBorder(),
            verticalAlign: VerticalAlign.CENTER,
            children: [
              dashedBox([
                para([run("[TDFB LOGO]", { size: 20, color: "999999", italics: true })], {
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 0 },
                }),
              ]),
            ],
          }),
          new TableCell({
            width: { size: 78, type: WidthType.PERCENTAGE },
            borders: noBorder(),
            verticalAlign: VerticalAlign.CENTER,
            children: [
              para([run("บริษัท ทีดี ฟู้ดแอนด์เบเวอร์เรจ จำกัด", { bold: true, size: 32 })], {
                spacing: { after: 40, line: 260 },
              }),
              para(
                [run("300 ถนนประชาอุทิศ แขวงทุ่งครุ เขตทุ่งครุ กรุงเทพมหานคร 10140", { size: 24, color: "444444" })],
                { spacing: { after: 20, line: 240 } }
              ),
              para([run("โทร 096-009-3570", { size: 24, color: "444444" })], {
                spacing: { after: 0, line: 240 },
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function buildDateTable(dateText: string) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorder(),
    rows: [
      new TableRow({
        children: [
          new TableCell({ width: { size: 60, type: WidthType.PERCENTAGE }, borders: noBorder(), children: [new Paragraph("")] }),
          new TableCell({
            width: { size: 40, type: WidthType.PERCENTAGE },
            borders: thinBorder(),
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
            children: [
              para([run("วันที่ "), run(dateText, { bold: true })], {
                alignment: AlignmentType.CENTER,
                spacing: { after: 0 },
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function buildIdPhotoCellContent(idCardImage?: { buffer: Buffer; type: "png" | "jpg" }) {
  if (idCardImage) {
    const img = new ImageRun({
      type: idCardImage.type,
      data: idCardImage.buffer,
      transformation: { width: 220, height: 140 },
    });
    return new Bookmark({ id: "id_card_photo", children: [img] });
  }
  // No photo supplied — leave the bookmark in place (empty) so the
  // document still opens and the position can be filled in by hand later.
  return new Bookmark({ id: "id_card_photo", children: [] });
}

function buildFooterTable(payeeName: string, idCardImage?: { buffer: Buffer; type: "png" | "jpg" }) {
  const photoNode = buildIdPhotoCellContent(idCardImage);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: thinBorder(),
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 45, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 160, bottom: 160, left: 160, right: 160 },
            children: [
              para([run("รูปภาพสำเนาบัตรประชาชน", { size: 22 })], {
                alignment: AlignmentType.CENTER,
                spacing: { after: 120 },
              }),
              dashedBox([
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 0 },
                  children: [photoNode],
                }),
              ]),
            ],
          }),
          new TableCell({
            width: { size: 55, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 160, bottom: 160, left: 160, right: 160 },
            children: [
              para([run("รับรองถูกต้องและได้รับเงินครบถ้วนตามจำนวนดังกล่าว")], {
                alignment: AlignmentType.CENTER,
                spacing: { after: 320 },
              }),
              para([run("ลงชื่อ "), run(" ".repeat(30), { underline: {} })], {
                alignment: AlignmentType.CENTER,
                spacing: { after: 30 },
              }),
              para([run(`(${payeeName})`, { bold: true })], {
                alignment: AlignmentType.CENTER,
                spacing: { after: 0 },
              }),
            ],
          }),
        ],
      }),
    ],
  });
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
  /** รูปสำเนาบัตรประชาชน — omit to leave the bookmark position empty */
  idCardImageBuffer?: Buffer;
  /** MIME type of idCardImageBuffer, defaults to image/png */
  idCardImageMimeType?: string;
}

function mimeToDocxImageType(mimeType?: string): "png" | "jpg" {
  return mimeType === "image/jpeg" || mimeType === "image/jpg" ? "jpg" : "png";
}

/** Builds the filled-in "เอกสารรับเงิน" .docx and returns it as a Buffer. */
export async function generateReceiptDoc(data: GenerateReceiptDocInput): Promise<Buffer> {
  const amountText = numberToThaiBahtText(data.amountNumber);
  const amountNumberText = data.amountNumber.toFixed(2);
  const idCardImage = data.idCardImageBuffer
    ? { buffer: data.idCardImageBuffer, type: mimeToDocxImageType(data.idCardImageMimeType) }
    : undefined;

  const children = [
    buildHeaderTable(),
    new Paragraph({ text: "", spacing: { after: 80 } }),
    ruleLine(),
    new Paragraph({ text: "", spacing: { after: 200 } }),
    para([run("เอกสารการรับเงิน", { bold: true, size: 40 })], {
      alignment: AlignmentType.CENTER,
      spacing: { after: 260 },
    }),
    buildDateTable(data.docDate),
    new Paragraph({ text: "", spacing: { after: 200 } }),

    para(
      [
        run("ข้าพเจ้า นาย / นางสาว / นาง "),
        run(data.payeeName),
        run("     เลขประจำตัวประชาชน "),
        run(data.idNumber),
      ],
      { alignment: AlignmentType.JUSTIFIED }
    ),

    para(
      [run("ได้รับเงินจาก บริษัท ทีดี ฟู้ดแอนด์เบเวอร์เรจ จำกัด เป็นค่า "), run(data.expenseDetail)],
      { alignment: AlignmentType.JUSTIFIED }
    ),

    para(
      [
        run("เป็นจำนวนเงิน "),
        run(amountNumberText),
        run(" บาท ("),
        run(amountText),
        run(")"),
      ],
      { alignment: AlignmentType.JUSTIFIED, spacing: { after: 280 } }
    ),

    para([run("เอกสารแนบ", { bold: true, size: 32 })], { spacing: { after: 140 } }),
    para([run("1. ใบเบิกทดรองจ่าย / ใบรับรองแทนใบเสร็จรับเงิน")], { spacing: { after: 60 } }),
    para([run("2. เอกสารการรับเงิน")], { spacing: { after: 60 } }),
    para([run("3. ใบเสร็จ / ใบกำกับภาษี")], { spacing: { after: 320 } }),

    buildFooterTable(data.payeeName, idCardImage),
  ];

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1300, bottom: 1300, left: 1440, right: 1440 },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
