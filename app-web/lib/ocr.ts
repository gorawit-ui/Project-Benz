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
// image/PDF bytes alongside a text prompt.
const MODEL = "gemini-2.5-flash";

const DOCUMENT_TYPES: DocumentType[] = ["ใบเสร็จรับเงิน", "ใบกำกับภาษี", "บิลเงินสด"];
const CONFIDENCE_LEVELS: OcrConfidence[] = ["high", "medium", "low"];

const PROMPT = `คุณกำลังอ่านเอกสารใบเสร็จ/ใบกำกับภาษี/บิลเงินสดของธุรกิจไทย (Thai business receipt, tax invoice, or cash bill) จากรูปภาพหรือ PDF ที่แนบมา ให้แยกข้อมูลออกมาตาม schema ที่กำหนด โดยทำตามกฎต่อไปนี้อย่างเคร่งครัด:

1. documentType — เดาจากลักษณะเอกสารที่เห็น: ถ้าเป็นใบกำกับภาษีเต็มรูปแบบ (มีเลขประจำตัวผู้เสียภาษี/Tax ID ของผู้ขาย และคำว่า "ใบกำกับภาษี") ให้ตอบ "ใบกำกับภาษี"; ถ้าเป็นใบเสร็จรับเงินทั่วไปที่มีหัวกระดาษร้าน/บริษัทแต่ไม่ใช่ใบกำกับภาษีเต็มรูป ให้ตอบ "ใบเสร็จรับเงิน"; ถ้าเป็นสลิปเงินสด/ใบเสร็จง่ายๆ จากร้านสะดวกซื้อหรือร้านค้าย่อยที่ไม่มีรายละเอียดทางบัญชีครบ ให้ตอบ "บิลเงินสด"

2. billDate — วันที่บนเอกสาร (ไม่ใช่วันครบกำหนดชำระ/Due Date) ต้องแปลงเป็นรูปแบบ ISO YYYY-MM-DD แบบปีคริสต์ศักราช (Gregorian) เสมอ **สำคัญมาก**: เอกสารไทยมักแสดงปีเป็นพุทธศักราช (พ.ศ.) เช่น "12 ส.ค. 2569" ซึ่งหมายถึง ค.ศ. 2026 — ให้ตรวจสอบว่าปีที่เห็นมากกว่า 2400 หรือไม่ ถ้าใช่ให้ลบ 543 ก่อนแปลงเป็น Gregorian year เสมอ (2569 - 543 = 2026) ถ้าปีที่เห็นเป็นคริสต์ศักราชอยู่แล้ว (เช่น 2026) ให้ใช้ตามนั้นโดยไม่ต้องลบ

3. จำนวนเงิน — ถ้าเอกสารแสดง VAT แยกไว้ชัดเจนอยู่แล้ว (จำนวนเงินก่อน VAT, VAT, ยอดรวม) ให้ใช้ตัวเลขที่พิมพ์ไว้ตรงๆ อย่าคำนวณเอง แต่ถ้าเอกสารแสดงแค่ยอดรวม (grand total) โดยไม่ได้แยก VAT ไว้ ให้คำนวณย้อนกลับ: amountBeforeVat = grandTotal / 1.07, vatAmount = grandTotal - amountBeforeVat ปัดเศษทั้งสองค่าเป็น 2 ตำแหน่งทศนิยม

4. expenseDetail — สรุปสั้นๆ เป็นภาษาไทยว่าซื้ออะไร/ค่าอะไร (ไม่ใช่การ dump รายการสินค้าทุกบรรทัด) เช่น "ค่าน้ำมันรถ" หรือ "ซื้ออุปกรณ์สำนักงาน"

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
    expenseDetail: { type: Type.STRING, nullable: true, description: "รายละเอียดค่าใช้จ่ายแบบสั้น" },
    billDate: {
      type: Type.STRING,
      nullable: true,
      description: "วันที่ในบิล รูปแบบ YYYY-MM-DD ปีคริสต์ศักราชเท่านั้น",
    },
    documentNumber: { type: Type.STRING, nullable: true, description: "เลขที่เอกสาร" },
    amountBeforeVat: { type: Type.NUMBER, nullable: true, description: "จำนวนเงินก่อน VAT" },
    vatAmount: { type: Type.NUMBER, nullable: true, description: "VAT 7%" },
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
