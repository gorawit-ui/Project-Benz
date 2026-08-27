/**
 * OCR / AI receipt reading, via the Gemini API (Google's current
 * `@google/genai` SDK — not the deprecated `@google/generative-ai` package).
 *
 * This reads a photographed/attached Thai receipt or tax invoice and
 * extracts the subset of `ExpenseRow` fields (see lib/sheets.ts) that a
 * document image can plausibly answer, so `ExpenseForm` can prefill itself
 * and the employee only has to review/correct instead of typing everything
 * from a blank form (see docs/02-requirements-from-pop.md: "อ่านจากเอกสารบิล
 * ถ้ากำกวมให้ตีเข้าประเภทที่เป็นไปได้มากที่สุด").
 *
 * OCR failing (missing API key, network error, malformed model output, ...)
 * must never block the expense form — every failure path here returns an
 * empty-ish `ExtractedReceiptData` rather than throwing, so the caller
 * (app/api/ocr/route.ts) can always degrade to "fill the form manually".
 */
import { GoogleGenAI, Type } from "@google/genai";
import type { DocumentType } from "./sheets";

export type OcrConfidence = "high" | "medium" | "low";

export interface ExtractedReceiptData {
  documentType?: DocumentType;
  supplierNameTh?: string;
  supplierNameEn?: string;
  expenseDetail?: string;
  billDate?: string; // YYYY-MM-DD, Gregorian
  documentNumber?: string;
  amountBeforeVat?: number;
  vatAmount?: number;
  grandTotal?: number;
  confidence?: OcrConfidence;
}

// A current, fast, multimodal-capable Gemini model that accepts inline
// image/PDF bytes alongside a text prompt. gemini-2.5-flash was retired for
// new API keys (Gemini API returns 404 "no longer available to new users");
// gemini-3.6-flash is its replacement per Google's own error message.
const MODEL = "gemini-3.6-flash";

const DOCUMENT_TYPES: DocumentType[] = [
  "ใบเสร็จรับเงิน",
  "ใบกำกับภาษี",
  "บิลเงินสด",
  "บิลทางด่วน",
  "สลิป Grab",
];
const CONFIDENCE_LEVELS: OcrConfidence[] = ["high", "medium", "low"];

const PROMPT = `คุณกำลังอ่านเอกสารใบเสร็จ/ใบกำกับภาษี/บิลเงินสดของธุรกิจไทย (Thai business receipt, tax invoice, or cash bill) จากรูปภาพหรือ PDF ที่แนบมา ให้แยกข้อมูลออกมาตาม schema ที่กำหนด โดยทำตามกฎต่อไปนี้อย่างเคร่งครัด:

1. documentType — เดาจากลักษณะเอกสารที่เห็น:
   - "ใบกำกับภาษี" — ใบกำกับภาษีเต็มรูปแบบ (มีเลขประจำตัวผู้เสียภาษี/Tax ID ของผู้ขาย และคำว่า "ใบกำกับภาษี")
   - "ใบเสร็จรับเงิน" — ใบเสร็จรับเงินทั่วไปที่มีหัวกระดาษร้าน/บริษัทแต่ไม่ใช่ใบกำกับภาษีเต็มรูป
   - "บิลเงินสด" — สลิปเงินสด/ใบเสร็จง่ายๆ จากร้านสะดวกซื้อหรือร้านค้าย่อยที่ไม่มีรายละเอียดทางบัญชีครบ
   - "บิลทางด่วน" — สลิปค่าผ่านทางพิเศษ/ทางด่วน มักเป็นกระดาษความร้อนใบเล็ก มีคำว่า "ค่าผ่านทาง", "ทางพิเศษ", "ด่าน", "การทางพิเศษแห่งประเทศไทย", "กทพ.", "EXAT", "BEM", "ดอนเมืองโทลล์เวย์" หรือ "Tollway"
   - "สลิป Grab" — ภาพหน้าจอ (screenshot) จากแอป Grab มีโลโก้/คำว่า "Grab" พร้อมรายละเอียดการเดินทางหรือการสั่งอาหาร

1ก. **ถ้าเป็น "บิลทางด่วน"** ให้อ่านแบบนี้:
   - grandTotal — อ่านตัวเลขค่าผ่านทางที่พิมพ์บนสลิปตามจริง (สลิปทางด่วนมักมีตัวเลขเดียวที่เป็นจำนวนเงิน) **ห้ามเดาจากราคาที่พบบ่อย** ค่าผ่านทางแต่ละด่านไม่เท่ากันและมีการปรับราคา ให้อ่านจากภาพเท่านั้น ระวังสับสนกับเลขด่าน เลขช่องทาง เลขที่รถ หรือเวลา ซึ่งไม่ใช่จำนวนเงิน
   - supplierNameTh — ชื่อผู้ให้บริการที่เห็นบนสลิป (เช่น "การทางพิเศษแห่งประเทศไทย") ถ้าไม่เห็นชื่อชัดเจนให้เว้นไว้ อย่าเดา
   - expenseDetail — ระบุว่าเป็นค่าผ่านทาง และใส่ชื่อด่าน/เส้นทางถ้าอ่านได้ เช่น "ค่าผ่านทางพิเศษ ด่านอโศก"
   - billDate — วันที่บนสลิป (สลิปทางด่วนมักมีทั้งวันที่และเวลา ให้เอาเฉพาะวันที่)
   - VAT — สลิปทางด่วนส่วนใหญ่ไม่ได้แสดง VAT แยก ให้ทำตามข้อ 3 (ค) คือใส่แค่ grandTotal อย่าคำนวณ VAT เอง

1ข. **ถ้าเป็น "สลิป Grab"** ให้อ่านแบบนี้:
   - supplierNameEn — "Grab"
   - grandTotal — **ยอดที่ถูกเรียกเก็บจริง (ยอดสุทธิ/Total/ยอดรวม)** หน้าจอ Grab มักแสดงหลายตัวเลข เช่น ค่าโดยสารตั้งต้น ส่วนลด/โปรโมชัน ค่าบริการ และยอดรวม — ให้เอา**ยอดรวมสุดท้ายที่จ่ายจริงหลังหักส่วนลดแล้ว** ไม่ใช่ค่าโดยสารก่อนหักส่วนลด
   - expenseDetail — ระบุประเภทและเส้นทาง เช่น "ค่าเดินทาง Grab จาก <ต้นทาง> ไป <ปลายทาง>" โดยใช้ชื่อสถานที่ตามที่แสดงบนหน้าจอ ถ้าเป็นการสั่งอาหาร (GrabFood) ให้ระบุชื่อร้านและรายการแทน
   - billDate — วันที่ของการเดินทาง/คำสั่งซื้อที่แสดงบนหน้าจอ
   - documentNumber — รหัสการเดินทาง/หมายเลขคำสั่งซื้อ (Booking ID / Order ID) ถ้ามี
   - VAT — ถ้าหน้าจอไม่ได้แยก VAT ไว้ ให้ทำตามข้อ 3 (ค) อย่าคำนวณเอง

2. billDate — วันที่บนเอกสาร (ไม่ใช่วันครบกำหนดชำระ/Due Date) ต้องแปลงเป็นรูปแบบ ISO YYYY-MM-DD แบบปีคริสต์ศักราช (Gregorian) เสมอ **สำคัญมาก**: เอกสารไทยมักแสดงปีเป็นพุทธศักราช (พ.ศ.) เช่น "12 ส.ค. 2569" ซึ่งหมายถึง ค.ศ. 2026 — ให้ตรวจสอบว่าปีที่เห็นมากกว่า 2400 หรือไม่ ถ้าใช่ให้ลบ 543 ก่อนแปลงเป็น Gregorian year เสมอ (2569 - 543 = 2026) ถ้าปีที่เห็นเป็นคริสต์ศักราชอยู่แล้ว (เช่น 2026) ให้ใช้ตามนั้นโดยไม่ต้องลบ

3. จำนวนเงิน — มี 3 กรณี:
   ก) เอกสารแสดง VAT แยกไว้ชัดเจนอยู่แล้ว (จำนวนเงินก่อน VAT, VAT, ยอดรวม ครบทั้ง 3 หรืออย่างน้อย 2 ใน 3) — ให้ใช้ตัวเลขที่พิมพ์ไว้ตรงๆ อย่าคำนวณเอง
   ข) เอกสารแสดงแค่ยอดรวมเดียว แต่มีสัญญาณว่ายอดนั้นรวม VAT อยู่ (เช่น มีคำว่า "VAT", "ภาษีมูลค่าเพิ่ม", "รวม VAT แล้ว", มีเลขประจำตัวผู้เสียภาษีของผู้ขาย, หรือเอกสารเป็นใบกำกับภาษีเต็มรูปแบบ) — ให้คำนวณย้อนกลับ: amountBeforeVat = grandTotal / 1.07, vatAmount = grandTotal - amountBeforeVat ปัดเศษทั้งสองค่าเป็น 2 ตำแหน่งทศนิยม
   ค) เอกสารแสดงแค่ยอดรวมเดียว และ**ไม่มีสัญญาณใดๆ เลย**ว่าเกี่ยวข้องกับ VAT (ไม่มีคำว่า VAT/ภาษีมูลค่าเพิ่มปรากฏที่ไหนเลย ไม่มีเลขผู้เสียภาษี ไม่ใช่ใบกำกับภาษี — เช่น บิลเงินสดร้านเล็กๆ ทั่วไป) — **ห้ามคำนวณ VAT เอง** ให้ใส่ตัวเลขนั้นลงใน grandTotal เพียงฟิลด์เดียว แล้วเว้น amountBeforeVat กับ vatAmount ไว้ (ไม่ต้องตอบ/ไม่ต้องเดา) เพราะบิลจำนวนมากไม่มี VAT จริงๆ การสมมติว่ามี VAT 7% ซ่อนอยู่เสมอจะทำให้ตัวเลขผิด

4. expenseDetail — ดึงรายละเอียด "รายการ" ให้ครบถ้วนที่สุดเท่าที่เอกสารมี (ชื่อ/คำอธิบายรายการ และเลขที่อ้างอิงถ้ามี) ห้ามสรุปย่อเป็นประโยคสั้นๆ เพียงประโยคเดียว **ห้ามใส่จำนวนเงินของแต่ละรายการไว้ในฟิลด์นี้เด็ดขาด** (ตัวเลขจำนวนเงินให้ใส่เฉพาะในฟิลด์ amountBeforeVat/vatAmount/grandTotal เท่านั้น) ถ้าเอกสารมีหลายรายการ (เช่น มีตารางรายการ/หลายบรรทัด/หลายเลขที่อ้างอิง) ให้ลิสต์ทุกรายการแยกกัน **คนละบรรทัด โดยขึ้นบรรทัดใหม่ (อักขระ newline \\n) คั่นระหว่างแต่ละรายการ** เช่น
"ค่าธรรมเนียมใบอนุญาต เลขที่ 001\nค่าธรรมเนียมใบอนุญาต เลขที่ 002\nค่าธรรมเนียมใบอนุญาต เลขที่ 003\nค่าธรรมเนียมใบอนุญาต เลขที่ 004"
ถ้าเอกสารมีรายการเดียว ให้ระบุชื่อรายการนั้นให้ครบถ้วนตามที่ปรากฏบนเอกสาร (ไม่ต้องย่อ) โดยไม่ต้องใส่จำนวนเงิน

5. supplierNameTh / supplierNameEn — ชื่อร้าน/บริษัทผู้ออกเอกสาร ใส่เฉพาะภาษาที่เห็นจริงบนเอกสาร (ถ้าเห็นแค่ภาษาไทยก็ใส่แค่ supplierNameTh อย่าแปล/เดาชื่อภาษาอังกฤษเอง)

6. documentNumber — เลขที่เอกสาร/เลขที่ใบเสร็จ/เลขที่ใบกำกับภาษีที่พิมพ์บนเอกสาร

7. ถ้าอ่านฟิลด์ไหนไม่ออกจริงๆ หรือเอกสารไม่มีข้อมูลนั้น ให้เว้นฟิลด์นั้นไว้ (อย่าเดาหรือสมมติค่าขึ้นมาเอง)

8. confidence — ประเมินความมั่นใจของตัวเองว่าอ่านเอกสารนี้ได้ชัดเจนแค่ไหน: "high" ถ้าเอกสารชัดเจน อ่านครบทุกฟิลด์หลักได้มั่นใจ, "medium" ถ้าพออ่านได้แต่มีบางจุดไม่แน่ใจ, "low" ถ้าภาพเบลอ ไม่ชัด ถูกครอบตัด แสงไม่พอ หรืออ่านได้ไม่ครบ

ตอบกลับเป็น JSON ตาม schema เท่านั้น`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    documentType: {
      type: Type.STRING,
      enum: DOCUMENT_TYPES,
      nullable: true,
      description: "ประเภทเอกสาร เดาจากลักษณะที่เห็น",
    },
    supplierNameTh: { type: Type.STRING, nullable: true, description: "ชื่อซัพพลายเออร์ (ไทย)" },
    supplierNameEn: { type: Type.STRING, nullable: true, description: "ชื่อซัพพลายเออร์ (English)" },
    expenseDetail: {
      type: Type.STRING,
      nullable: true,
      description: "รายละเอียดค่าใช้จ่ายแบบเต็ม ไม่ใส่จำนวนเงิน แยกแต่ละรายการด้วยการขึ้นบรรทัดใหม่ (\\n)",
    },
    billDate: {
      type: Type.STRING,
      nullable: true,
      description: "วันที่ในบิล รูปแบบ YYYY-MM-DD ปีคริสต์ศักราชเท่านั้น",
    },
    documentNumber: { type: Type.STRING, nullable: true, description: "เลขที่เอกสาร" },
    amountBeforeVat: {
      type: Type.NUMBER,
      nullable: true,
      description: "จำนวนเงินก่อน VAT — เว้นว่างถ้าเอกสารไม่มีสัญญาณว่าเกี่ยวข้องกับ VAT เลย",
    },
    vatAmount: {
      type: Type.NUMBER,
      nullable: true,
      description: "VAT 7% — เว้นว่างถ้าเอกสารไม่มีสัญญาณว่าเกี่ยวข้องกับ VAT เลย",
    },
    grandTotal: { type: Type.NUMBER, nullable: true, description: "ยอดรวม (Grand Total)" },
    confidence: {
      type: Type.STRING,
      enum: CONFIDENCE_LEVELS,
      nullable: true,
      description: "ความมั่นใจของโมเดลในการอ่านเอกสารนี้",
    },
  },
};

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asOptionalDocumentType(value: unknown): DocumentType | undefined {
  return typeof value === "string" && (DOCUMENT_TYPES as string[]).includes(value)
    ? (value as DocumentType)
    : undefined;
}

function asOptionalConfidence(value: unknown): OcrConfidence | undefined {
  return typeof value === "string" && (CONFIDENCE_LEVELS as string[]).includes(value)
    ? (value as OcrConfidence)
    : undefined;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function asOptionalIsoDate(value: unknown): string | undefined {
  const str = asOptionalString(value);
  if (!str || !ISO_DATE_RE.test(str)) return undefined;
  return str;
}

/**
 * Validates/coerces whatever the model returned into ExtractedReceiptData,
 * dropping anything that doesn't match the expected shape rather than
 * trusting the model's JSON blindly.
 */
function sanitize(raw: unknown): ExtractedReceiptData {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const result: ExtractedReceiptData = {
    documentType: asOptionalDocumentType(obj.documentType),
    supplierNameTh: asOptionalString(obj.supplierNameTh),
    supplierNameEn: asOptionalString(obj.supplierNameEn),
    expenseDetail: asOptionalString(obj.expenseDetail),
    billDate: asOptionalIsoDate(obj.billDate),
    documentNumber: asOptionalString(obj.documentNumber),
    amountBeforeVat: asOptionalNumber(obj.amountBeforeVat),
    vatAmount: asOptionalNumber(obj.vatAmount),
    grandTotal: asOptionalNumber(obj.grandTotal),
    confidence: asOptionalConfidence(obj.confidence),
  };
  // Strip undefined keys so callers can rely on `"field" in result` /
  // `Object.keys(result)` reflecting only what was actually extracted.
  return Object.fromEntries(Object.entries(result).filter(([, v]) => v !== undefined)) as ExtractedReceiptData;
}

/**
 * Reads a photographed/scanned Thai receipt and extracts the fields
 * ExpenseForm needs to prefill itself. Never throws — any failure (missing
 * API key, network/API error, malformed model output) resolves to `{}` so
 * the caller can fall back to manual entry.
 */
export async function extractReceiptData(fileBuffer: Buffer, mimeType: string): Promise<ExtractedReceiptData> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("extractReceiptData: GEMINI_API_KEY is not set, skipping OCR");
    return {};
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [{ text: PROMPT }, { inlineData: { data: fileBuffer.toString("base64"), mimeType } }],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const text = response.text;
    if (!text) {
      console.error("extractReceiptData: empty response from Gemini");
      return {};
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      console.error("extractReceiptData: failed to parse Gemini JSON response", err);
      return {};
    }

    return sanitize(parsed);
  } catch (err) {
    console.error("extractReceiptData: Gemini API call failed", err);
    return {};
  }
}
