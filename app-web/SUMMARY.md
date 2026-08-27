# TDFB Expense Tracking — Logic Summary

สรุป logic การทำงานหลักของโปรเจกต์ สำหรับคนที่ต้องการเข้าใจภาพรวมโดยไม่ต้องไล่อ่านโค้ดทั้งหมด
ไม่มี API key/credential ใดๆ อยู่ในไฟล์นี้ — ค่าจริงทั้งหมดอยู่ใน environment variables (ดู `.env.example`)

---

## 1. Image Reading (OCR / อ่านใบเสร็จ)

**Model:** Google **Gemini** (`gemini-3.6-flash`) ผ่าน SDK `@google/genai`

**ไม่ใช่ OCR แบบดั้งเดิม** (ไม่ใช่ Tesseract/Google Vision text-detection) แต่เป็น vision-language model ที่ "ดูรูปทั้งใบแล้วเข้าใจบริบท" ไม่ใช่อ่านตัวอักษรทีละตัวแล้วต่อกัน — วิธีนี้ทำให้จัดการกับเอกสารที่มีรูปแบบหลากหลาย (ใบเสร็จ/ใบกำกับภาษี/สลิปทางด่วน/screenshot แอป) ได้โดยไม่ต้องเขียน parser แยกทีละแบบ

**ไฟล์หลัก:** `lib/ocr.ts` (ฟังก์ชัน `extractReceiptData`) เรียกจาก `app/api/ocr/route.ts`

### Flow

```
ผู้ใช้อัปโหลดรูป/PDF
  → app/api/ocr/route.ts
      รับไฟล์ (multipart form), เช็ค mime type (jpeg/png/pdf เท่านั้น)
  → lib/ocr.ts: extractReceiptData(buffer, mimeType)
      1. เช็ค GEMINI_API_KEY — ถ้าไม่มี คืน {} ทันที (ไม่ throw)
      2. ส่ง [PROMPT, รูปแบบ base64 inlineData] ไปที่ Gemini
      3. บังคับให้ Gemini ตอบเป็น JSON ตาม responseSchema ที่กำหนดไว้ตายตัว
         (Gemini "structured output" — ไม่ใช่การ parse ข้อความอิสระ)
      4. sanitize() ตรวจ/กรองทุกฟิลด์ก่อนคืนค่า (type coercion + validation,
         ไม่เชื่อ JSON จากโมเดลตรงๆ)
  → คืน ExtractedReceiptData ให้ ExpenseForm ไปเติมฟอร์มอัตโนมัติ
```

**Key call:**
```ts
const ai = new GoogleGenAI({ apiKey });
const response = await ai.models.generateContent({
  model: "gemini-3.6-flash",
  contents: [{
    role: "user",
    parts: [
      { text: PROMPT },
      { inlineData: { data: fileBuffer.toString("base64"), mimeType } },
    ],
  }],
  config: {
    responseMimeType: "application/json",
    responseSchema: RESPONSE_SCHEMA, // schema บังคับ field/type ที่ต้องตอบกลับ
  },
});
```

### สิ่งที่ prompt สั่งให้อ่าน (ภาษาไทยทั้งหมดใน source จริง สรุปเป็นข้อๆ)

1. **จำแนกประเภทเอกสาร** — เลือก 1 ใน 5: `ใบเสร็จรับเงิน` / `ใบกำกับภาษี` / `บิลเงินสด` / `บิลทางด่วน` / `สลิป Grab`
   - **บิลทางด่วน**: อ่านยอดที่พิมพ์จริงเท่านั้น ห้ามเดาจากราคาที่พบบ่อย (ราคาค่าผ่านทางเปลี่ยนได้ตามด่าน/เวลา) ระวังสับสนกับเลขด่าน/เลขช่องทาง/เวลา
   - **สลิป Grab**: เอา **ยอดสุทธิที่จ่ายจริงหลังหักส่วนลดแล้ว** ไม่ใช่ค่าโดยสารตั้งต้นก่อนหักโปรโมชัน
2. **แปลงวันที่ พ.ศ. → ค.ศ. อัตโนมัติ** — เช็คว่าปีที่เห็น > 2400 หรือไม่ ถ้าใช่ให้ลบ 543 ก่อนแปลงเป็น ISO `YYYY-MM-DD`
3. **ตรรกะ VAT แบบมีเงื่อนไข 3 กรณี:**
   - (ก) เอกสารแยก VAT ไว้ชัดเจนอยู่แล้ว → ใช้ตัวเลขที่พิมพ์ไว้ตรงๆ ไม่คำนวณเอง
   - (ข) มีแค่ยอดเดียว แต่มีสัญญาณว่ารวม VAT (คำว่า "VAT", เลขผู้เสียภาษี, เป็นใบกำกับภาษีเต็มรูป) → คำนวณย้อนกลับ `amountBeforeVat = grandTotal / 1.07`
   - (ค) มีแค่ยอดเดียวและ**ไม่มีสัญญาณ VAT เลย** → **ห้ามคำนวณ VAT เอง** ใส่แค่ `grandTotal` เว้นอีก 2 ฟิลด์ว่าง (ป้องกันการสมมติว่ามี VAT ซ่อนอยู่เสมอ ซึ่งจะทำให้ตัวเลขผิดกับบิลที่ไม่มี VAT จริงๆ)
4. **รายละเอียดค่าใช้จ่าย** — ห้ามใส่จำนวนเงินปนในฟิลด์นี้เด็ดขาด ถ้ามีหลายรายการให้ขึ้นบรรทัดใหม่คั่นด้วย `\n`
5. **ชื่อซัพพลายเออร์** ไทย/อังกฤษ แยกฟิลด์ — ใส่เฉพาะภาษาที่เห็นจริงบนเอกสาร ห้ามแปล/เดาชื่ออีกภาษาเอง
6. **เลขที่เอกสาร**
7. ฟิลด์ไหนอ่านไม่ออกจริงๆ **ห้ามเดาหรือสมมติค่า** ให้เว้นว่างไว้
8. **confidence** — ให้โมเดลประเมินความมั่นใจตัวเอง (`high` / `medium` / `low`) — ถ้า `low` ฝั่งฟอร์มจะเตือนผู้ใช้ให้ตรวจสอบซ้ำก่อนบันทึก

### Reliability

`extractReceiptData` **ไม่โยน error ออกไปเลยในทุกกรณี** (ไม่มี API key, เรียก API ไม่สำเร็จ, JSON parse ไม่ผ่าน) — คืนค่า `{}` เสมอ เพื่อให้ผู้ใช้ยัง fallback ไปกรอกฟอร์มมือได้โดยไม่มีอะไรค้าง/พัง

---

## 2. Category / Account Mapping

**สถานะปัจจุบัน: Rule-based (keyword matching) แต่ตาราง mapping ยังว่างเปล่า — logic การจับคู่อัตโนมัติยังไม่ทำงานจริง รอออกแบบเพิ่มเติม**

**ไฟล์:** `lib/categoryMapping.ts`

โครงสร้างแบ่งเป็น 2 ชั้นแยกจากกันชัดเจน:

### ชั้น A — ตัวเลือกในดรอปดาวน์ (มีข้อมูลจริงแล้ว ตรวจสอบกับ Odoo แล้ว)

`CATEGORY_OPTIONS` (43 รายการ) และ `ACC_NAME_OPTIONS` (18 รายการ) — เป็นรายชื่อ category/account จริงของทีม GM ดึงมาจาก Odoo (`product.product.default_code` / `account.account.code`) ผู้ใช้เลือกเองด้วยมือทั้งสองช่องอิสระต่อกัน ค่า `[CODE]` หน้าชื่อคือส่วนที่ผูกกับ Odoo จริง ต้องคงไว้เป๊ะ

**Category options เต็ม (43 รายการ):**
```ts
export const CATEGORY_OPTIONS: string[] = [
  "สวัสดิการ",
  "สำนักงาน-วัสดุสิ้นเปลือง",
  "[EXP00000000004] เครื่องมือเครื่องใช้",
  "[EXP00000000007] ค่าธรรมเนียมขอใบอนุญาต",
  "[EXP00000000023] ค่าส่วนลดโปรโมชั่น",
  "[EXP00000000025] ค่าใช้จ่ายในการเดินทาง (ค่าน้ำมัน,ทางด่วน,จอดรถ)",
  "[EXP00000000026] ค่าขนมพนักงาน Factory/WH-300/Exp Cafe ",
  "[EXP00000000029] ค่าชุดตรวจโควิด/ชุดตรวจกัญชา",
  "[EXP00000000030] ค่าอาหาร",
  "[EXP00000000031] ค่าจัดส่งเอกสาร (DHL,EMS)",
  "[EXP00000000032] ค่ากระดาษA4 +อุปกรณ์เครื่องเขียน",
  "[EXP00000000033] ่ค่ากระดาษโน๊ต ปากกา ไวท์บอร์ด",
  "[EXP00000000034] ค่าหมึก HP 955XL M",
  "[EXP00000000035] ค่าอุปกรณ์ทำความสะอาด ทิชชู ถุงขยะ",
  "[EXP00000000036] ค่าน้ำยาทำความสะอาดพื้น",
  "[EXP00000000037] ค่าซ่อมแซม/ค่าบำรุงรักษา",
  "[EXP00000000038] ค่าล้างแอร์ WH300",
  "[EXP00000000039] ค่าแม่บ้าน Factory/WH-300/Exp Cafe ",
  "[EXP00000000040] ค่าติดตั้งเครื่องมือเครื่องใช้อุปกรณ์ต่าง",
  "[EXP00000000041] ค่าโทรศัพท์ Bria Mobile Call center บริษัท",
  "[EXP00000000042] อากรสแตมป์ ",
  "[EXP00000000043] ค่าภาษีป้าย TDFB Factory",
  "[EXP00000000044] ค่าคัดหนังสือรับรอง/ฟอร์มต่าง",
  "[EXP00000000045] ค่าขยะมูลฝอย  Fac16",
  "[EXP00000000046] ค่าเลี้ยงรับรอง",
  "[EXP00000000047] ค่าซื้อของขวัญ",
  "[EXP00000000048] เบิกเงินสดย่อย",
  "[EXP00000000053] ค่าเงินมัดจำ/เงินประกันงาน",
  "[EXP00000000058] ค่าใช้จ่าย Outing",
  "[SER00000000002] ค่าบริการ-ซ่อมแซม",
  "[SER00000000003] ค่าธรรมเนียมขอใบอนุญาต",
  "[SER00000000018] ค่าจัดส่งไปรษณีย์",
  "[SER00000000019] ค่าสัมมนา/ฝึกอบรม/หนังสือ",
  "[SER00000000020] ค่าเครื่องเขียนแบบพิมพ์",
  "[SER00000000022] ค่าซ่อมแซมบำรุงรักษา",
  "[SER00000000023] ค่าบริการงานทั่วไป",
  "[SER00000000025] ค่าจ้างแม่บ้าน",
  "[SER00000000027] ค่าไฟฟ้า",
  "[SER00000000028] ค่าน้ำประปา",
  "[SER00000000029] ค่าโทรศัพท์&อินเตอร์เน็ต",
  "[SER00000000030] ค่าเบี้ยประกันภัย",
  "[SER00000000032] ค่าธรรมเนียมอื่น",
  "[SER00000000033] ค่ารับรอง/เลี้ยงลูกค้า/ของขวัญ",
];
```

**Acc name options เต็ม (18 รายการ):**
```ts
export const ACC_NAME_OPTIONS: string[] = [
  "[141002] ส่วนปรับปรุงอาคารเช่า",
  "[141005] อุปกรณ์สำนักงาน",
  "[513006] ค่าวัสดุสิ้นเปลืองใช้ไป",
  "[513013] ค่าซ่อมแซมบำรุงรักษา",
  "[531006] ค่าจ้างที่ปรึกษา",
  "[531007] ค่าเดินทางยานพาหนะ",
  "[531008] ค่าสวัสดิการพนักงาน",
  "[532001] ค่าเช่าออฟฟิศ",
  "[532004] ค่าสัมมนา/ฝึกอบรม/หนังสือ",
  "[532005] เครื่องเขียนแบบพิมพ์",
  "[532006] ค่าวัสดุของใช้สิ้นเปลือง-สนง.",
  "[532009] ค่าบริการงานทั่วไป",
  "[533001] ค่าไฟฟ้า",
  "[533002] ค่าน้ำประปา",
  "[533003] ค่าโทรศัพท์&อินเตอร์เน็ต",
  "[535000] ค่าเบี้ยประกันภัย",
  "[536004] ค่าธรรมเนียมอื่น",
  "[537003] ค่ารับรอง/เลี้ยงลูกค้า/ของขวัญ",
];
```

> **หมายเหตุ:** ค่า string ทั้งหมดเก็บ **byte-identical กับ Odoo** รวมถึงจุดที่ดูเหมือนพิมพ์ผิด (เว้นวรรคท้ายบางรายการ, เว้นวรรคคู่ใน "ค่าขยะมูลฝอย  Fac16", ไม้เอกเกินใน "่ค่ากระดาษโน๊ต") — ยืนยันแล้วว่าเป็นค่าที่เก็บใน Odoo จริงแบบนั้น ไม่ใช่พิมพ์เพี้ยนตอนก็อปมา **ห้ามแก้ไขให้ "ดูสะอาด" เพราะจะไม่ตรงกับ Odoo อีกต่อไป**

### ชั้น B — Logic การจับคู่อัตโนมัติ (rule-based, ว่างเปล่า รอออกแบบ)

```ts
// Category -> default acc name (สำหรับ auto-fill เวลาเลือก category)
export const CATEGORY_ACC_PAIRS: CategoryAccPair[] = [];  // ← ว่าง

// Keyword matching: ชื่อร้าน/รายละเอียด -> category + accName
export const CATEGORY_RULES: CategoryRule[] = [
  // { keywords: ["เซเว่น", "7-eleven"], category: "[EXP00000000030] ค่าอาหาร",
  //   accName: "[531008] ค่าสวัสดิการพนักงาน" },
];  // ← ว่าง (ตัวอย่างที่ comment ไว้คือ template ไม่ใช่ rule จริง)

// วิธีจับคู่: substring match, case-insensitive, กฎแรกที่ตรง = ชนะ
export function matchCategoryAndAccName(vendorName, description) {
  const haystack = `${vendorName} ${description}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some(k => haystack.includes(k.toLowerCase()))) {
      return { category: rule.category, accName: rule.accName };
    }
  }
  return null;
}
```

**เพราะ `CATEGORY_RULES` ว่าง → `matchCategoryAndAccName` คืนค่า `null` เสมอตอนนี้** หลัง OCR อ่านบิลเสร็จ ช่องหมวดหมู่/บัญชีจะว่างให้ผู้ใช้เลือกเองทุกครั้ง ยังไม่มีการเดาอัตโนมัติเกิดขึ้นจริงในโปรดักชัน

**วิธีเปิดใช้งาน:** เติมข้อมูลลง `CATEGORY_ACC_PAIRS` และ/หรือ `CATEGORY_RULES` เท่านั้น — โค้ดฝั่งฟอร์ม (`ExpenseForm.tsx`) เรียก `getAccNameForCategory()` และ `matchCategoryAndAccName()` ไว้พร้อมแล้ว ไม่ต้องแก้โค้ดที่อื่น

---

## 3. Google Sheet Writing

**Library:** `googleapis` (Google's official Node.js SDK) เรียกผ่าน **Google Sheets API v4** โดยตรง

**ไม่มี database คั่นกลาง — Google Sheet คือฐานข้อมูลจริง**

**Auth:** ใช้ OAuth access token ของ**ผู้ใช้แต่ละคนที่ล็อกอินอยู่** (ไม่ใช่ service account กลางตัวเดียว) ทุก request ทำในนามคนนั้นๆ

**ไฟล์หลัก:** `lib/sheets.ts`

### โครงสร้างไฟล์/แท็บ

```
1 ทีม (GM, HR, ...) = 1 Google Sheet แยกกันคนละไฟล์
  └─ แท็บ "Expense Tracking" = template ต้นแบบ (ไม่มีข้อมูลจริง)
  └─ แท็บ "2569-08 สิงหาคม" = ข้อมูลเดือนสิงหาคม 2569 (สร้างอัตโนมัติจาก template
     ตอนมีบิลแรกของเดือนนั้น — duplicateSheet ผ่าน Sheets API)
  └─ แท็บ "2569-09 กันยายน" = เดือนถัดไป ...
  └─ แท็บ "_DriveFolders" (ซ่อน) = ตารางจับคู่ folder key -> Drive folder ID
  └─ แท็บ "_PayeeTemplates" (ซ่อน) = รายชื่อผู้รับเงินที่บันทึกไว้ใช้ซ้ำ
```
- ข้อมูลจริงเริ่มที่ **แถวที่ 7** เสมอ (แถว 1-6 = หัวเรื่อง/คำอธิบาย/หัวตาราง/ตัวอย่าง)
- **26 คอลัมน์ (A ถึง Z)** ตายตัว ตรงกับ `ExpenseRow` interface ใน TypeScript แบบ 1:1

### Field Structure เต็ม (26 คอลัมน์ A→Z)

| Col | Field (TS) | Header ภาษาไทย |
|---|---|---|
| A | `id` | รหัสรายการ |
| B | `recordedAt` | วันที่บันทึกเข้าระบบ |
| C | `recordedBy` | ผู้บันทึก |
| D | `status` | สถานะ |
| E | `fundType` | ประเภทเงิน (เงินสดย่อย/เงินทดรองจ่าย) |
| F | `documentType` | ประเภทเอกสาร |
| G | `documentNumber` | เลขที่เอกสาร |
| H | `poNumber` | เลขที่ PO |
| I | `billDate` | วันที่ในบิล (Date) |
| J | `supplierNameTh` | ชื่อซัพพลายเออร์ (ไทย) |
| K | `supplierNameEn` | ชื่อซัพพลายเออร์ (English) |
| L | `expenseDetail` | รายละเอียดค่าใช้จ่าย (Description) |
| M | `odooCategory` | หมวดหมู่ (ตาม Odoo) |
| N | `costCenter` | Cost Center |
| O | `accName` | Acc name |
| P | `amountBeforeVat` | จำนวนเงินก่อน VAT |
| Q | `vatAmount` | VAT 7% |
| R | `grandTotal` | ยอดรวม (Grand Total) |
| S | `receiptFileLink` | ลิงก์ไฟล์ใบเสร็จ (Drive) |
| T | `receiptDocLink` | ลิงก์เอกสารรับเงิน (กรณีบิลไม่สมบูรณ์) |
| U | `duplicateWarning` | แจ้งเตือนรายการซ้ำ |
| V | `odooId` | ID Odoo / ID Express |
| W | `reviewedBy` | ผู้ตรวจทาน |
| X | `reviewedAt` | วันที่ตรวจทาน |
| Y | `note` | หมายเหตุ |
| Z | `repaymentStatus` | สถานะจ่ายคืน (เฉพาะเงินทดรองจ่าย) |

### วิธีเขียน/แก้ไขข้อมูล

**การเขียนแถวใหม่** (`appendExpenseRow`): คำนวณเลขแถวถัดไปจากจำนวนเซลล์ "รหัสรายการ" ที่มีอยู่แล้ว (**ไม่ใช้ `values.append`** เพราะ Sheets API auto-detect ตำแหน่งจาก A1 จะพลาดถ้าแถวตัวอย่าง (แถว 6) ถูกลบไป)

**การแก้ไขแถวเดิม** (เปลี่ยนสถานะ, มาร์คจ่ายคืน, ผูกลิงก์เอกสาร ฯลฯ): **หาแถวจากค่า "รหัสรายการ" (คอลัมน์ A) เสมอ ไม่จำตำแหน่งแถว** — กันปัญหาถ้ามีคนเรียงลำดับ/กรองแถวในชีตด้วยมือ

```ts
async function findRowNumberById(sheets, sheetId, tabName, rowId) {
  // อ่านคอลัมน์ A ทั้งหมด หา index ที่ค่าตรงกับ rowId แล้วคืนเลขแถวจริง
}
```

**การรันเลข ID** (`generateExpenseId`): สแกนคอลัมน์ A ของ**ทุกแท็บเดือน**พร้อมกัน หาตัวเลขสูงสุดของ prefix ทีม (เช่น `GM`) แล้ว +1 → ได้ `GM00001`, `GM00002`, ... (ไม่ใช้ timestamp เพราะต้องการเลขรันต่อเนื่องไม่ซ้ำ)

---

## 4. Project Structure

### `app/` — Pages & API Routes (Next.js App Router)

| ไฟล์ | หน้าที่ |
|---|---|
| `layout.tsx` | Root layout: ฟอนต์ Prompt, metadata (title, OG image), NavBar, ReportBugButton |
| `page.tsx` | หน้าแรก — ทางเลือกไปบันทึกบิล/สร้างเอกสารรับเงิน |
| `login/page.tsx` | หน้า login ด้วย Google OAuth (2 คอลัมน์: รูปทีม + ปุ่ม login) |
| `dashboard/page.tsx` | โหลด `DashboardView` component |
| `review/page.tsx` | โหลด `ReviewList` component |
| `receipt-doc/create/page.tsx` | โหลด `ReceiptDocForm` component |
| `manifest.ts` | Web App Manifest (ติดตั้งเป็น PWA ลงหน้าจอมือถือ) |
| `globals.css` | Tailwind base + fix cursor:pointer บนปุ่มทั้งหมด |
| `icon.png` / `apple-icon.png` | ไอคอนแท็บเบราว์เซอร์ / iOS home screen |
| `api/auth/[...nextauth]/route.ts` | NextAuth.js: Google OAuth config, refresh-token rotation |
| `api/expenses/route.ts` | `GET` รายการบิลของเดือน / `POST` บันทึกบิลใหม่ |
| `api/expenses/[id]/status/route.ts` | เปลี่ยนสถานะ (ตรวจแล้ว/ต้องแก้ไข/ยกเลิก) |
| `api/expenses/[id]/repayment-status/route.ts` | toggle สถานะจ่ายคืนแล้ว/ยังไม่จ่าย |
| `api/expenses/months/route.ts` | list ชื่อแท็บเดือนทั้งหมดที่มีอยู่ |
| `api/expenses/petty-cash-status/route.ts` | เช็ควงเงินเงินสดย่อยเดือนนี้ใช้ไปเท่าไหร่แล้ว |
| `api/ocr/route.ts` | รับรูป/PDF → เรียก Gemini อ่าน → คืนข้อมูลให้ฟอร์ม |
| `api/upload/route.ts` | อัปโหลดไฟล์ใบเสร็จต้นฉบับเข้า Google Drive |
| `api/receipt-doc/route.ts` | สร้าง PDF เอกสารรับเงิน + อัปโหลด Drive + ผูกกลับ Sheet |
| `api/payee-templates/route.ts` | CRUD รายชื่อผู้รับเงินที่บันทึกไว้ใช้ซ้ำ |
| `api/drive-file/[fileId]/route.ts` | proxy ดึงไฟล์รูปจาก Drive แบบส่วนตัว (ไม่เปิดสาธารณะ) |
| `api/report-bug/route.ts` | รับแจ้งบัค (ข้อความ+รูป) → อัปโหลด Drive → ส่ง Slack |

### `components/` — React UI

| ไฟล์ | หน้าที่ |
|---|---|
| `ExpenseForm.tsx` | ฟอร์มบันทึกบิลหลัก — เรียก OCR, auto-classify ประเภทเงิน, เช็คบิลซ้ำ, เก็บ draft กันข้อมูลหาย |
| `CaptureFlow.tsx` | ควบคุมขั้นตอน: เลือกถ่ายรูป/แนบไฟล์ → ส่งต่อไป ExpenseForm |
| `CaptureStep.tsx` | หน้าจอเลือก "ถ่ายรูปบัตร" / "แนบไฟล์" |
| `ComboBox.tsx` | dropdown ค้นหาได้เอง ใช้ซ้ำได้ (หมวดหมู่ Odoo, ผู้รับเงิน) |
| `DashboardView.tsx` | แดชบอร์ด — สรุปวงเงินเงินสดย่อย/ทดรองจ่าย, breakdown ตามหมวดหมู่, ยกเลิกรายการ, ดูรูปบิล |
| `ReviewList.tsx` | หน้าตรวจอนุมัติบิล + bulk approve หลายรายการพร้อมกัน |
| `ReceiptDocForm.tsx` | สร้างเอกสารรับเงิน (PDF), เลือก/บันทึกผู้รับเงินที่ใช้ซ้ำ |
| `ReceiptViewer.tsx` | popup ดูรูปบิลแบบเต็มจอ (thumbnail + lightbox) |
| `NavBar.tsx` | เมนูบนสุด — โลโก้, ทีม, นาฬิกา+คำทักทายตามเวลา, ลิงก์เมนู |
| `ReportBugButton.tsx` | ปุ่มลอยมุมจอสำหรับแจ้งปัญหา |
| `SessionProviderWrapper.tsx` | ครอบ NextAuth `SessionProvider` ให้ทุกหน้าใช้ session ได้ |

### `lib/` — Business Logic

| ไฟล์ | หน้าที่ |
|---|---|
| `ocr.ts` | เรียก Gemini อ่านบิล (รายละเอียดในหัวข้อ 1) |
| `sheets.ts` | อ่าน/เขียน Google Sheet ทั้งหมด (รายละเอียดในหัวข้อ 3) |
| `categoryMapping.ts` | ตัวเลือกหมวดหมู่/บัญชี + logic จับคู่อัตโนมัติ (รายละเอียดในหัวข้อ 2) |
| `pettyCash.ts` | กฎจำแนกเงินสดย่อย vs เงินทดรองจ่าย (เพดาน ฿20,000/เดือน, นับสะสมทั้งเดือน) |
| `duplicateCheck.ts` | เช็คบิลซ้ำ: ชื่อร้าน + ยอดเงิน + วันที่ในบิล ตรงกันทั้ง 3 |
| `drive.ts` | อัปโหลด/ดาวน์โหลดไฟล์ Google Drive, จัดการโฟลเดอร์รายเดือน |
| `driveLinks.ts` | แยก Drive file ID จาก URL (pure function, ใช้ได้ทั้ง client/server) |
| `receiptDoc.ts` | สร้างไฟล์ PDF เอกสารรับเงิน ด้วย `pdfkit` |
| `payeeTemplates.ts` | บันทึก/อ่าน/ลบ ชื่อผู้รับเงินที่ใช้ซ้ำ (เก็บในแท็บซ่อนของ Sheet) |
| `teams.ts` | routing ตามทีม — แต่ละทีม (GM/HR) มี Sheet ID / Drive folder ของตัวเอง |
| `auth.ts` | ตั้งค่า NextAuth: Google provider, JWT callback, refresh-token rotation |
| `slack.ts` | ส่งข้อความแจ้งบัคเข้า Slack ผ่าน Incoming Webhook |
| `month.ts` | สร้าง/ตรวจสอบชื่อแท็บเดือน (รูปแบบ "YYYY(พ.ศ.)-MM ชื่อเดือนไทย") |
| `thaiDate.ts` | แปลงวันที่เป็นรูปแบบไทย (พ.ศ.) สำหรับแสดงในเอกสาร |
| `thaiBahtText.ts` | แปลงตัวเลขเป็นคำอ่านภาษาไทย (เช่น 1,250 → "หนึ่งพันสองร้อยห้าสิบบาทถ้วน") |
| `thaiId.ts` | จัดกลุ่มเลขบัตรประชาชน 13 หลักตามรูปแบบบนบัตรจริง (1-4-5-2-1) |

### `lib/__tests__/` — Automated Tests

| ไฟล์ | ครอบคลุม |
|---|---|
| `money.test.ts` | ยอดเงินสดย่อย, การตัดประเภทเงินที่ขอบวงเงิน, การยกเลิกคืนเงิน, บิลซ้ำ, แท็บเดือน, เลขบาทเป็นคำอ่าน (22 เคส) |
| `payeeTemplates.test.ts` | การอ้างอิงแถวชีตของรายชื่อผู้รับเงินที่บันทึกไว้ ไม่ให้สลับแถวกันเวลามีแถวว่างคั่น (5 เคส) |
| `thaiId.test.ts` | การจัดกลุ่มเลขบัตรประชาชน (3 เคส) |

รวม 30 เคส รันด้วย `npx vitest run`

### อื่นๆ

| ไฟล์/โฟลเดอร์ | หน้าที่ |
|---|---|
| `assets/fonts/` | ฟอนต์ Sarabun (Regular/Bold) สำหรับ render ข้อความไทยแบบ offline (PDF, OG image) |
| `assets/tdfb-logo.jpg`, `assets/tdfb-app-icon.png` | โลโก้/ไอคอนต้นฉบับความละเอียดเต็ม |
| `assets/ledger-illustration.png` | รูปประกอบ OG image |
| `public/` | ไอคอน PWA ทุกขนาด, OG image, manifest icons |
| `scripts/generate-og-image.py` | สคริปต์สร้างรูป OG image ใหม่ (รันซ้ำได้ผลลัพธ์เดิมทุกครั้ง) |
| `README.md` | คู่มือ setup โปรเจกต์ (env vars, การรัน dev/build) |
| `.env.example` | รายชื่อ environment variables ที่ต้องตั้งค่า (ไม่มีค่าจริง) |
