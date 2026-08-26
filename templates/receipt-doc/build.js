const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, VerticalAlign, ImageRun,
  Bookmark, ShadingType,
} = require("docx");

const FONT = "TH Sarabun New";

function run(text, opts = {}) {
  return new TextRun({ text, font: FONT, size: 30, ...opts });
}

function para(children, opts = {}) {
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

function dashedBox(cellChildren, widthPct = 100) {
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
              para([run("บริษัท ทีดี ฟู้ดแอนด์เบเวอร์เรจ จำกัด", { bold: true, size: 32 })], { spacing: { after: 40, line: 260 } }),
              para([run("300 ถนนประชาอุทิศ แขวงทุ่งครุ เขตทุ่งครุ กรุงเทพมหานคร 10140", { size: 24, color: "444444" })], { spacing: { after: 20, line: 240 } }),
              para([run("โทร 096-009-3570", { size: 24, color: "444444" })], { spacing: { after: 0, line: 240 } }),
            ],
          }),
        ],
      }),
    ],
  });
}

function buildDateTable(dateText) {
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
            children: [para([run("วันที่ "), run(dateText, { bold: true })], { alignment: AlignmentType.CENTER, spacing: { after: 0 } })],
          }),
        ],
      }),
    ],
  });
}

function buildIdPhotoCellContent(mode, samplePng) {
  if (mode === "filled" && samplePng) {
    const img = new ImageRun({
      type: "png",
      data: samplePng,
      transformation: { width: 220, height: 140 },
    });
    return new Bookmark({
      id: "id_card_photo",
      children: [img],
    });
  }
  return new Bookmark({
    id: "id_card_photo",
    children: [run("{{id_card_photo}}", { color: "1F5C4C", bold: true, size: 22 })],
  });
}

function buildFooterTable(mode, payeeName, samplePng) {
  const photoNode = buildIdPhotoCellContent(mode, samplePng);
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
              para([run("รูปภาพสำเนาบัตรประชาชน", { size: 22 })], { alignment: AlignmentType.CENTER, spacing: { after: 120 } }),
              dashedBox([
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 0 },
                  children: [photoNode.start, ...photoNode.children, photoNode.end],
                }),
              ]),
            ],
          }),
          new TableCell({
            width: { size: 55, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 160, bottom: 160, left: 160, right: 160 },
            children: [
              para([run("รับรองถูกต้องและได้รับเงินครบถ้วนตามจำนวนดังกล่าว")], { alignment: AlignmentType.CENTER, spacing: { after: 320 } }),
              para([
                run("ลงชื่อ "),
                run(" ".repeat(30), { underline: {} }),
              ], { alignment: AlignmentType.CENTER, spacing: { after: 30 } }),
              para([run(`(${payeeName})`, { bold: true })], { alignment: AlignmentType.CENTER, spacing: { after: 0 } }),
            ],
          }),
        ],
      }),
    ],
  });
}

function buildDoc(mode) {
  const samplePng = mode === "filled" ? fs.readFileSync("sample_id_card.png") : null;

  const v = mode === "filled"
    ? {
        date: "26 สิงหาคม 2569",
        payeeName: "สมชาย ใจดี",
        idNumber: "1-2345-67890-12-3",
        expenseDetail: "ซื้ออุปกรณ์ทำความสะอาด ที่ร้าน 7-Eleven",
        amountNumber: "202.00",
        amountText: "สองร้อยสองบาทถ้วน",
      }
    : {
        date: "{{doc_date}}",
        payeeName: "{{payee_name}}",
        idNumber: "{{id_number}}",
        expenseDetail: "{{expense_detail}}",
        amountNumber: "{{amount_number}}",
        amountText: "{{amount_text}}",
      };

  const highlight = mode === "template" ? { color: "1F5C4C", bold: true } : {};

  const children = [
    buildHeaderTable(),
    new Paragraph({ text: "", spacing: { after: 80 } }),
    ruleLine(),
    new Paragraph({ text: "", spacing: { after: 200 } }),
    para([run("เอกสารการรับเงิน", { bold: true, size: 40 })], { alignment: AlignmentType.CENTER, spacing: { after: 260 } }),
    buildDateTable(v.date),
    new Paragraph({ text: "", spacing: { after: 200 } }),

    para([
      run("ข้าพเจ้า นาย / นางสาว / นาง "),
      run(v.payeeName, highlight),
      run("     เลขประจำตัวประชาชน "),
      run(v.idNumber, highlight),
    ], { alignment: AlignmentType.JUSTIFIED }),

    para([
      run("ได้รับเงินจาก บริษัท ทีดี ฟู้ดแอนด์เบเวอร์เรจ จำกัด เป็นค่า "),
      run(v.expenseDetail, highlight),
    ], { alignment: AlignmentType.JUSTIFIED }),

    para([
      run("เป็นจำนวนเงิน "),
      run(v.amountNumber, highlight),
      run(" บาท ("),
      run(v.amountText, highlight),
      run(")"),
    ], { alignment: AlignmentType.JUSTIFIED, spacing: { after: 280 } }),

    para([run("เอกสารแนบ", { bold: true, size: 32 })], { spacing: { after: 140 } }),
    para([run("1. ใบเบิกทดรองจ่าย / ใบรับรองแทนใบเสร็จรับเงิน")], { spacing: { after: 60 } }),
    para([run("2. เอกสารการรับเงิน")], { spacing: { after: 60 } }),
    para([run("3. ใบเสร็จ / ใบกำกับภาษี")], { spacing: { after: 320 } }),

    buildFooterTable(mode, v.payeeName, samplePng),
  ];

  return new Document({
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
}

async function main() {
  const templateDoc = buildDoc("template");
  const filledDoc = buildDoc("filled");

  fs.writeFileSync("เอกสารรับเงิน - Template (พร้อมแท็ก).docx", await Packer.toBuffer(templateDoc));
  fs.writeFileSync("เอกสารรับเงิน - ตัวอย่างกรอกแล้ว.docx", await Packer.toBuffer(filledDoc));
  console.log("done");
}

main();
