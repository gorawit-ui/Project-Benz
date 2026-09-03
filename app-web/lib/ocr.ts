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
import { CATEGORY_OPTIONS, ACC_NAME_OPTIONS } from "./categoryMapping";

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
  // Gemini's own best guess at หมวดหมู่/Acc name from the vendor name +
  // expense detail it just read (constrained to CATEGORY_OPTIONS /
  // ACC_NAME_OPTIONS below via `enum`, so it can only pick a real Odoo value,
  // never invent one). This is a starting point for the user to review, not
  // a verified classification — ExpenseForm shows a "please check this"
  // note whenever it's applied, and clears it the moment either field is
  // touched by hand.
  suggestedCategory?: string;
  suggestedAccName?: string;
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

9. suggestedCategory / suggestedAccName — จากชื่อผู้ขาย (supplierName) และรายละเอียดค่าใช้จ่าย (expenseDetail) ที่อ่านได้จากข้อ 4-5 ให้ช่วยแนะนำหมวดหมู่ (suggestedCategory) และชื่อบัญชี (suggestedAccName) ที่น่าจะตรงกับรายการนี้มากที่สุด **โดยเลือกจากรายการที่กำหนดไว้ใน enum เท่านั้น ห้ามคิดค่าขึ้นมาเองเด็ดขาด แม้จะสะกดหรือความหมายใกล้เคียงแค่ไหนก็ตาม** ถ้าไม่มีตัวเลือกไหนที่ตรงกับลักษณะรายการอย่างชัดเจนจริงๆ ให้เว้นทั้งสองฟิลด์นี้ไว้ (อย่าเดาแบบขอไปที) เพราะนี่เป็นแค่คำแนะนำเบื้องต้นให้ผู้ใช้ตรวจสอบต่อเอง ไม่ใช่การจัดหมวดหมู่ที่ยืนยันแล้ว

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
    suggestedCategory: {
      type: Type.STRING,
      enum: CATEGORY_OPTIONS,
      nullable: true,
      description:
        "หมวดหมู่ (ตาม Odoo) ที่แนะนำจากชื่อผู้ขาย/รายละเอียดค่าใช้จ่าย — คำแนะนำเบื้องต้นเท่านั้น เว้นว่างถ้าไม่มั่นใจ",
    },
    suggestedAccName: {
      type: Type.STRING,
      enum: ACC_NAME_OPTIONS,
      nullable: true,
      description:
        "ชื่อบัญชี (Acc name) ที่แนะนำจากชื่อผู้ขาย/รายละเอียดค่าใช้จ่าย — คำแนะนำเบื้องต้นเท่านั้น เว้นว่างถ้าไม่มั่นใจ",
    },
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

// `enum` in RESPONSE_SCHEMA already constrains what Gemini can return, but
// sanitize() re-checks against the same live lists rather than trusting the
// model's JSON blindly — belt and suspenders, and it stays correct even if
// CATEGORY_OPTIONS/ACC_NAME_OPTIONS change without the schema being rebuilt.
function asOptionalCategory(value: unknown): string | undefined {
  return typeof value === "string" && CATEGORY_OPTIONS.includes(value) ? value : undefined;
}

function asOptionalAccName(value: unknown): string | undefined {
  return typeof value === "string" && ACC_NAME_OPTIONS.includes(value) ? value : undefined;
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
export function sanitize(raw: unknown): ExtractedReceiptData {
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
    suggestedCategory: asOptionalCategory(obj.suggestedCategory),
    suggestedAccName: asOptionalAccName(obj.suggestedAccName),
    confidence: asOptionalConfidence(obj.confidence),
  };
  // Strip undefined keys so callers can rely on `"field" in result` /
  // `Object.keys(result)` reflecting only what was actually extracted.
  return Object.fromEntries(Object.entries(result).filter(([, v]) => v !== undefined)) as ExtractedReceiptData;
}

/** Why an OCR attempt produced nothing, when it produced nothing for a reason. */
export type OcrFailureCode = "missing_api_key" | "api_error" | "empty_response" | "bad_json";

export interface OcrResult {
  data: ExtractedReceiptData;
  /**
   * Set ONLY when extraction failed outright. A successful read that simply
   * couldn't find any fields leaves this undefined with empty `data` — the
   * two used to be indistinguishable (every failure collapsed to `{}` and
   * the form cheerfully reported "อ่านข้อมูลจากใบเสร็จแล้ว" over a blank
   * form), which is exactly how a totally broken OCR call went unnoticed.
   */
  failure?: { code: OcrFailureCode; detail: string; status?: number };
}

/**
 * Upstream statuses worth trying again. 503 UNAVAILABLE is the one that
 * actually bit us: Gemini answers "this model is currently experiencing high
 * demand" when it's busy (free-tier traffic is shed first), which is
 * transient — the same file reads fine seconds later. A single attempt
 * turned that into "OCR is broken" and dumped the user into manual entry.
 *
 * Deliberately excludes 400 (bad request), 401/403 (auth) and 404 (no such
 * model): retrying those just burns the user's time on a certain failure.
 */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
/**
 * Wall-clock ceiling for all attempts combined. The route allows 60s
 * (maxDuration), so this leaves headroom to still return a real error
 * instead of being killed mid-retry — being killed is what produced an
 * unexplained failure in the first place.
 */
const RETRY_BUDGET_MS = 40_000;

/** Pulls the upstream HTTP status out of whatever shape the SDK threw. */
export function upstreamStatusFrom(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const maybe = err as { status?: unknown; code?: unknown };
    if (typeof maybe.status === "number") return maybe.status;
    if (typeof maybe.code === "number") return maybe.code;
  }
  // The SDK commonly stringifies the API's own body into the message, e.g.
  // {"error":{"code":503,"message":"...","status":"UNAVAILABLE"}}
  const raw = err instanceof Error ? err.message : String(err);
  const match = /"code"\s*:\s*(\d{3})/.exec(raw);
  return match ? Number(match[1]) : undefined;
}

/** Backoff with jitter, so a batch's retries don't all land on the same instant. */
function retryDelayMs(attempt: number): number {
  return Math.round(1000 * 2 ** (attempt - 1) * (1 + Math.random() * 0.3));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Redacts anything key-shaped before an upstream error message is allowed
 * anywhere near a response body: Google's client can embed the request URL
 * (which carries `?key=…`) in its error text, and that must never reach the
 * browser or a log the user can screenshot.
 */
function safeErrorDetail(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/key=[^&\s"']+/gi, "key=***")
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, "***")
    .slice(0, 300);
}

/**
 * Reads a photographed/scanned Thai receipt and extracts the fields
 * ExpenseForm needs to prefill itself. Never throws — any failure (missing
 * API key, network/API error, malformed model output) comes back as an
 * `OcrResult` with `failure` set, so the caller can both fall back to manual
 * entry AND tell the user what actually went wrong.
 */
export async function extractReceiptData(fileBuffer: Buffer, mimeType: string): Promise<OcrResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("extractReceiptData: GEMINI_API_KEY is not set, skipping OCR");
    return { data: {}, failure: { code: "missing_api_key", detail: "GEMINI_API_KEY is not configured" } };
  }

  const startedAt = Date.now();
  try {
    const ai = new GoogleGenAI({ apiKey });
    const request = {
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
    };

    let response;
    for (let attempt = 1; ; attempt++) {
      try {
        response = await ai.models.generateContent(request);
        break;
      } catch (err) {
        const status = upstreamStatusFrom(err);
        const delay = retryDelayMs(attempt);
        const canRetry =
          attempt < MAX_ATTEMPTS &&
          status !== undefined &&
          RETRYABLE_STATUSES.has(status) &&
          // Only start another attempt if there's room to finish it inside
          // the route's own time budget.
          Date.now() - startedAt + delay < RETRY_BUDGET_MS;
        if (!canRetry) throw err;
        console.warn(
          `extractReceiptData: ${status} from Gemini, retrying (attempt ${attempt + 1}/${MAX_ATTEMPTS}) in ${delay}ms`
        );
        await sleep(delay);
      }
    }

    const text = response.text;
    if (!text) {
      console.error("extractReceiptData: empty response from Gemini");
      return { data: {}, failure: { code: "empty_response", detail: `model ${MODEL} returned no text` } };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      console.error("extractReceiptData: failed to parse Gemini JSON response", err);
      return { data: {}, failure: { code: "bad_json", detail: safeErrorDetail(err) } };
    }

    return { data: sanitize(parsed) };
  } catch (err) {
    console.error("extractReceiptData: Gemini API call failed", err);
    return {
      data: {},
      failure: { code: "api_error", detail: safeErrorDetail(err), status: upstreamStatusFrom(err) },
    };
  }
}
