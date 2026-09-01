"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { DocumentType, ExpenseRow, FundType } from "@/lib/sheets";
import type { ExtractedReceiptData } from "@/lib/ocr";
import { findDuplicateExpense } from "@/lib/duplicateCheck";
import { CATEGORY_OPTIONS, ACC_NAME_OPTIONS, getAccNameForCategory, matchCategoryAndAccName } from "@/lib/categoryMapping";
import ComboBox from "./ComboBox";
import { ActionButton, SectionHeading } from "./ui";
import BilliMascot from "./BilliMascot";
import SuccessDialog from "./SuccessDialog";

const DOCUMENT_TYPES: DocumentType[] = [
  "ใบเสร็จรับเงิน",
  "ใบกำกับภาษี",
  "บิลเงินสด",
  "บิลทางด่วน",
  "สลิป Grab",
];

const VAT_RATE = 0.07;
// Fallback only — the real threshold always comes from
// /api/expenses/petty-cash-status (lib/pettyCash.ts is the source of truth).
const PETTY_CASH_THRESHOLD_FALLBACK = 20000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatBaht(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

/** Money inputs store a plain numeric string (no commas) in state — this only formats it for display, e.g. "8000" -> "8,000". */
function formatMoneyDisplay(raw: string): string {
  if (!raw) return raw;
  const [intPart, ...rest] = raw.split(".");
  const formattedInt = intPart === "" ? "" : Number(intPart).toLocaleString("en-US");
  return rest.length > 0 ? `${formattedInt}.${rest.join(".")}` : formattedInt;
}

/** Strips comma formatting (and any other non-numeric noise) back to the plain numeric string kept in state. */
function parseMoneyInput(display: string): string {
  return display.replace(/,/g, "").replace(/[^\d.]/g, "");
}

interface FormState {
  fundType: FundType;
  documentType: DocumentType;
  documentNumber: string;
  poNumber: string;
  billDate: string;
  supplierNameTh: string;
  supplierNameEn: string;
  expenseDetail: string;
  // หมวดหมู่ (ตาม Odoo) + Acc name always pair together (see
  // lib/categoryMapping.ts) — both render as a text input with a dropdown
  // of known pairs (still freely editable, since the real Odoo
  // chart-of-accounts list isn't loaded into that table yet; see
  // docs/04-open-items.md item A). Picking/auto-matching a category fills
  // in its paired acc name automatically.
  odooCategory: string;
  accName: string;
  amountBeforeVat: string;
  vatAmount: string;
  grandTotal: string;
  /** False when a receipt only has a net/grand total and no VAT signal. */
  hasVat: boolean;
}

/**
 * Where an in-progress bill is parked in the browser.
 *
 * Receipts get captured out in the field on a phone, so a dropped
 * connection, a backgrounded tab reclaimed by iOS, or a stray back-swipe
 * used to throw away everything typed. The draft is saved on every edit and
 * cleared only once the row is actually saved, so a failed submit keeps the
 * data instead of losing it.
 *
 * The attached photo is deliberately NOT part of the draft: File objects
 * can't be serialised, and stashing image bytes here would blow the ~5MB
 * localStorage budget. Re-attaching one photo is a far smaller loss than
 * re-typing the whole form.
 */
const DRAFT_KEY = "tdfb-expense-draft-v1";

/** True when the user has actually typed something worth offering back. */
function isDraftWorthKeeping(draft: FormState): boolean {
  return Boolean(
    draft.supplierNameTh.trim() ||
      draft.supplierNameEn.trim() ||
      draft.expenseDetail.trim() ||
      draft.documentNumber.trim() ||
      draft.grandTotal.trim() ||
      draft.amountBeforeVat.trim()
  );
}

const INITIAL_STATE: FormState = {
  fundType: "เงินสดย่อย",
  documentType: "ใบเสร็จรับเงิน",
  documentNumber: "",
  poNumber: "",
  billDate: "",
  supplierNameTh: "",
  supplierNameEn: "",
  expenseDetail: "",
  odooCategory: "",
  accName: "",
  amountBeforeVat: "",
  vatAmount: "",
  grandTotal: "",
  hasVat: true,
};

type OcrMessage = { type: "success" | "warning" | "error"; text: string };

export default function ExpenseForm({
  recordedByName,
  initialFile = null,
}: {
  recordedByName: string;
  /** Pre-selected from the capture step (CaptureFlow) — OCR runs on it automatically once, on mount. */
  initialFile?: File | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  // A draft recovered from a previous session, offered rather than applied —
  // see the DRAFT_KEY block below.
  const [recoverableDraft, setRecoverableDraft] = useState<FormState | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrMessage, setOcrMessage] = useState<OcrMessage | null>(null);

  // เงินสดย่อย vs เงินทดรองจ่าย auto-classification (see lib/pettyCash.ts) —
  // fundTypeTouched flips true the moment the user clicks a fund-type button
  // themselves, so auto-classification only ever sets a *default* and never
  // fights a manual choice afterwards.
  const [fundTypeTouched, setFundTypeTouched] = useState(false);
  const [pettyCashContext, setPettyCashContext] = useState<{ usedThisMonth: number; threshold: number } | null>(
    null
  );

  // True right after OCR fills หมวดหมู่/Acc name from Gemini's own guess
  // (data.suggestedCategory/suggestedAccName — see lib/ocr.ts), so the form
  // can nudge the user to double-check it. Same touched-flag shape as
  // fundTypeTouched above: flips false the instant the user actually
  // interacts with either field, so the reminder never lingers over a value
  // they've already reviewed.
  const [categorySuggestedByAi, setCategorySuggestedByAi] = useState(false);

  // Duplicate-bill detection (see lib/duplicateCheck.ts) — set only when
  // handleSubmit finds a match; submission is held until the user explicitly
  // confirms or cancels via the warning box below.
  const [duplicateMatch, setDuplicateMatch] = useState<ExpenseRow | null>(null);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const receiptPreviewUrl = useMemo(
    () => (receiptFile?.type.startsWith("image/") ? URL.createObjectURL(receiptFile) : null),
    [receiptFile]
  );

  useEffect(() => {
    return () => {
      if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl);
    };
  }, [receiptPreviewUrl]);

  // A file picked on the capture step (CaptureFlow) arrives here already
  // selected — kick off OCR for it once, the same way handleFileSelected
  // would for a file picked directly in this form.
  useEffect(() => {
    if (initialFile) {
      handleFileSelected(initialFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleAmountBeforeVatChange(value: string) {
    const numeric = parseFloat(value);
    if (Number.isFinite(numeric)) {
      const vat = round2(numeric * VAT_RATE);
      const total = round2(numeric + vat);
      setForm((prev) => ({
        ...prev,
        amountBeforeVat: value,
        vatAmount: String(vat),
        grandTotal: String(total),
      }));
    } else {
      set("amountBeforeVat", value);
    }
  }

  function handleGrandTotalChange(value: string) {
    setForm((prev) => (
      prev.hasVat
        ? { ...prev, grandTotal: value }
        : { ...prev, amountBeforeVat: value, vatAmount: "0", grandTotal: value }
    ));
  }

  function setVatEnabled(hasVat: boolean) {
    setForm((prev) => {
      if (hasVat) return { ...prev, hasVat: true };
      const total = prev.grandTotal || prev.amountBeforeVat;
      return { ...prev, hasVat: false, amountBeforeVat: total, vatAmount: "0", grandTotal: total };
    });
  }

  /**
   * Calls /api/expenses/petty-cash-status for the given billDate's month,
   * updates the context note next to the fund-type toggle, and — unless the
   * user has already manually clicked a fund-type button — auto-selects
   * เงินสดย่อย/เงินทดรองจ่าย per the confirmed ฿20,000/month rule. A bill is
   * never split: the whole amount goes to whichever side the running total
   * lands on. Never throws — a failed classification call just leaves the
   * current fund-type selection alone.
   */
  async function refreshPettyCashClassification(billDate: string, grandTotalValue: string) {
    const amount = parseFloat(grandTotalValue);
    if (!billDate || !Number.isFinite(amount) || amount <= 0) return;

    try {
      const res = await fetch(`/api/expenses/petty-cash-status?billDate=${encodeURIComponent(billDate)}`);
      if (!res.ok) return;
      const data = await res.json();
      const usedThisMonth = Number(data.usedThisMonth) || 0;
      const threshold = Number(data.threshold) || PETTY_CASH_THRESHOLD_FALLBACK;

      setPettyCashContext({ usedThisMonth, threshold });

      if (!fundTypeTouched) {
        const classified: FundType = usedThisMonth + amount <= threshold ? "เงินสดย่อย" : "เงินทดรองจ่าย";
        set("fundType", classified);
      }
    } catch {
      // auto-classification failing must never block manual entry
    }
  }

  /**
   * Merges OCR-extracted fields into the form. Only overwrites fields that
   * actually came back non-empty — a field OCR couldn't read is simply left
   * alone (whatever the user already typed, or blank, stays as-is).
   */
  function applyExtractedData(data: ExtractedReceiptData) {
    const patch: Partial<FormState> = {};
    if (data.documentType) patch.documentType = data.documentType;
    if (data.supplierNameTh) patch.supplierNameTh = data.supplierNameTh;
    if (data.supplierNameEn) patch.supplierNameEn = data.supplierNameEn;
    if (data.expenseDetail) patch.expenseDetail = data.expenseDetail;
    if (data.billDate) patch.billDate = data.billDate;
    if (data.documentNumber) patch.documentNumber = data.documentNumber;

    // หมวดหมู่ + Acc name auto-fill off the vendor name / expense detail OCR
    // just read (see lib/categoryMapping.ts). A curated keyword rule (once
    // CATEGORY_RULES has any) wins first since it's a vetted, deterministic
    // pairing; otherwise fall back to Gemini's own suggestedCategory/
    // suggestedAccName from the same OCR call. Either way this is a
    // best-guess starting point — categorySuggestedByAi below drives a
    // "please check this" note so it's never treated as already confirmed.
    const vendorForMatch = data.supplierNameTh || data.supplierNameEn || "";
    let suggestedByAi = false;
    if (vendorForMatch || data.expenseDetail) {
      const match = matchCategoryAndAccName(vendorForMatch, data.expenseDetail || "");
      if (match) {
        patch.odooCategory = match.category;
        patch.accName = match.accName;
      } else if (data.suggestedCategory || data.suggestedAccName) {
        if (data.suggestedCategory) patch.odooCategory = data.suggestedCategory;
        if (data.suggestedAccName) patch.accName = data.suggestedAccName;
        suggestedByAi = true;
      }
    }
    if (suggestedByAi) setCategorySuggestedByAi(true);

    const hasBeforeVat = data.amountBeforeVat !== undefined;
    const hasVat = data.vatAmount !== undefined;
    const hasTotal = data.grandTotal !== undefined;

    if (Object.keys(patch).length > 0) {
      setForm((prev) => ({ ...prev, ...patch }));
    }

    let effectiveGrandTotal: number | undefined;
    if (hasBeforeVat && !hasVat && !hasTotal) {
      // OCR only read the pre-VAT amount — reuse the existing auto-calc so
      // vatAmount/grandTotal derive from it exactly like manual entry does.
      handleAmountBeforeVatChange(String(data.amountBeforeVat));
      effectiveGrandTotal = round2(data.amountBeforeVat! + round2(data.amountBeforeVat! * VAT_RATE));
    } else if (hasTotal && !hasBeforeVat && !hasVat) {
      // A total-only receipt is not proof of VAT. Keep the UI in its
      // one-amount mode and normalize the hidden Sheet values safely.
      setForm((prev) => ({
        ...prev,
        ...patch,
        hasVat: false,
        amountBeforeVat: String(data.grandTotal),
        vatAmount: "0",
        grandTotal: String(data.grandTotal),
      }));
      effectiveGrandTotal = data.grandTotal;
    } else if (hasBeforeVat || hasVat || hasTotal) {
      // OCR read at least two of the three amounts itself — trust its own
      // read rather than overwriting it with the auto-calc.
      setForm((prev) => ({
        ...prev,
        ...(hasBeforeVat ? { amountBeforeVat: String(data.amountBeforeVat) } : {}),
        ...(hasVat ? { vatAmount: String(data.vatAmount) } : {}),
        ...(hasTotal ? { grandTotal: String(data.grandTotal) } : {}),
        hasVat: hasBeforeVat || hasVat,
      }));
      effectiveGrandTotal = hasTotal ? data.grandTotal : undefined;
    }

    // Right after OCR reads a bill date + total ("หลังถ่ายรูปก็คือเลือกเป็นสิ่งนี้"
    // per the product owner), auto-classify the fund type. Falls back to
    // whatever is already in the form when OCR didn't supply a new value.
    const billDateForClassification = data.billDate ?? form.billDate;
    const grandTotalForClassification =
      effectiveGrandTotal !== undefined ? String(effectiveGrandTotal) : form.grandTotal;
    if (billDateForClassification && grandTotalForClassification) {
      void refreshPettyCashClassification(billDateForClassification, grandTotalForClassification);
    }
  }

  async function runOcr(file: File) {
    setOcrLoading(true);
    setOcrMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/ocr", { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || "อ่านข้อมูลจากใบเสร็จไม่สำเร็จ");
      }
      const data = (json.data ?? {}) as ExtractedReceiptData;
      applyExtractedData(data);
      setOcrMessage(
        data.confidence === "low"
          ? { type: "warning", text: "อ่านข้อมูลได้ไม่ชัดเจน กรุณาตรวจสอบให้ละเอียด" }
          : { type: "success", text: "อ่านข้อมูลจากใบเสร็จแล้ว ตรวจสอบและแก้ไขได้ก่อนบันทึก" }
      );
    } catch (err) {
      // OCR failing must never block the flow — the file stays attached and
      // the employee can still fill the form in manually.
      setOcrMessage({
        type: "error",
        text: err instanceof Error ? err.message : "อ่านข้อมูลจากใบเสร็จไม่สำเร็จ กรุณากรอกข้อมูลเอง",
      });
    } finally {
      setOcrLoading(false);
    }
  }

  function handleFileSelected(file: File | null) {
    setReceiptFile(file);
    setCategorySuggestedByAi(false);
    if (file) {
      void runOcr(file);
    } else {
      setOcrMessage(null);
    }
  }

  async function uploadReceiptIfNeeded(): Promise<string> {
    if (!receiptFile) return "";
    const body = new FormData();
    body.append("file", receiptFile);
    body.append("supplierName", form.supplierNameEn || form.supplierNameTh || "receipt");
    const res = await fetch("/api/upload", { method: "POST", body });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "อัปโหลดไฟล์ใบเสร็จไม่สำเร็จ");
    }
    const data = await res.json();
    return data.webViewLink as string;
  }

  /** Actually appends the row — called either directly (no duplicate found) or after an explicit duplicate confirmation. */
  async function submitExpense(duplicateNote: string) {
    setSubmitting(true);
    try {
      const receiptFileLink = await uploadReceiptIfNeeded();

      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          amountBeforeVat: form.hasVat ? Number(form.amountBeforeVat) : Number(form.grandTotal),
          vatAmount: form.hasVat ? Number(form.vatAmount) : 0,
          grandTotal: Number(form.grandTotal),
          receiptFileLink,
          duplicateWarning: duplicateNote,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "บันทึกรายการไม่สำเร็จ");
      }

      setMessage({ type: "success", text: "บันทึกรายการเรียบร้อยแล้ว 🎉 ส่งเข้ารอตรวจให้เลย" });
      setShowSuccessDialog(true);
      // Only now is the draft safe to drop — a failed submit above keeps it.
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }
      setRecoverableDraft(null);
      setForm(INITIAL_STATE);
      setReceiptFile(null);
      setOcrMessage(null);
      setDuplicateMatch(null);
      setFundTypeTouched(false);
      setPettyCashContext(null);
      setCategorySuggestedByAi(false);
    } catch (err) {
      setMessage({
        type: "error",
        // Mention the draft: it has always been kept on a failed submit, but
        // nothing ever told the user, so a failure still felt like data loss.
        text: `${err instanceof Error ? err.message : "อุ๊ปส์ ส่งข้อมูลไม่สำเร็จ 😅"} — เช็คอินเทอร์เน็ตแล้วกดบันทึกอีกทีนะ ข้อมูลที่กรอกไว้ยังอยู่ครบ`,
      });
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Submit entry point: checks for a duplicate (same vendor + amount + bill
   * date, per lib/duplicateCheck.ts) before actually saving anything. A
   * match holds submission and shows a warning box requiring an explicit
   * second confirmation click — no duplicate means normal, frictionless
   * submission. The duplicate check itself failing (e.g. network hiccup)
   * must never block a legitimate submission, so it falls through to submit.
   */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setCheckingDuplicate(true);
    try {
      const res = await fetch("/api/expenses?billDate=" + encodeURIComponent(form.billDate));
      if (res.ok) {
        const data = await res.json();
        const rows = (data.rows ?? []) as ExpenseRow[];
        const match = findDuplicateExpense(rows, {
          supplierNameTh: form.supplierNameTh,
          grandTotal: Number(form.grandTotal),
          billDate: form.billDate,
        });
        if (match) {
          setDuplicateMatch(match);
          return;
        }
      }
    } catch {
      // duplicate check failing must never block a legitimate submission
    } finally {
      setCheckingDuplicate(false);
    }
    await submitExpense("");
  }

  async function confirmDuplicateAndSubmit() {
    if (!duplicateMatch) return;
    await submitExpense(`อาจซ้ำกับ ${duplicateMatch.id}`);
  }

  function cancelDuplicateWarning() {
    setDuplicateMatch(null);
  }

  // Offer back anything left over from a previous visit. Read once on mount;
  // never applied silently, since overwriting a form the user has already
  // started typing into would be worse than losing the draft.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(DRAFT_KEY);
      if (!stored) return;
      const storedDraft = JSON.parse(stored) as Partial<FormState>;
      // Drafts made before the VAT switch existed should retain the old,
      // VAT-enabled behaviour rather than being silently treated as no-VAT.
      const draft: FormState = { ...INITIAL_STATE, ...storedDraft, hasVat: storedDraft.hasVat ?? true };
      if (!isDraftWorthKeeping(draft)) return;
      // localStorage doesn't exist during SSR, so reading it on mount is
      // exactly the "sync from an external system" case effects are for.
      // Runs once and only sets the offer banner — no cascading renders.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRecoverableDraft(draft);
    } catch {
      // corrupt or unavailable storage (private mode) — nothing to recover
    }
  }, []);

  // Persist on every edit. Cheap: a handful of short strings.
  useEffect(() => {
    try {
      if (isDraftWorthKeeping(form)) {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
      } else {
        window.localStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      // storage full or blocked — saving a draft is best-effort only
    }
  }, [form]);

  const inputClass =
    "mt-1.5 min-h-11 w-full rounded-xl border border-[var(--line-strong)] bg-white px-3 py-2.5 text-sm text-[var(--ink)] outline-none transition placeholder:text-zinc-400 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-soft)]";
  const labelClass = "block text-sm font-medium text-[var(--ink)]";

  return (
    <form onSubmit={handleSubmit} className="space-y-7 rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-card)] sm:p-7">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
        <p className="text-sm font-medium text-[var(--ink)]">ตรวจข้อมูลทีละส่วน</p>
        <p className="text-xs text-[var(--muted)]">บันทึกโดย {recordedByName}</p>
      </div>

      {/* Unsent work from a previous visit. Restoring is the user's call —
          applying it automatically could clobber a form already in progress. */}
      {recoverableDraft && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">มีข้อมูลที่กรอกค้างไว้</p>
          <p className="mt-0.5 text-xs text-amber-800">
            {recoverableDraft.supplierNameTh || recoverableDraft.expenseDetail || "รายการที่ยังไม่ได้บันทึก"}
            {recoverableDraft.grandTotal ? ` · ${formatMoneyDisplay(recoverableDraft.grandTotal)} บาท` : ""}
            {" — กู้คืนมาแก้ต่อได้ (รูปบิลต้องแนบใหม่)"}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setForm(recoverableDraft);
                setRecoverableDraft(null);
                setFundTypeTouched(true); // a restored fund type is a real choice, don't re-classify over it
              }}
              className="flex-1 rounded-md bg-amber-700 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-800 sm:flex-none"
            >
              กู้คืนข้อมูล
            </button>
            <button
              type="button"
              onClick={() => {
                setRecoverableDraft(null);
                try {
                  window.localStorage.removeItem(DRAFT_KEY);
                } catch {
                  // ignore
                }
              }}
              className="flex-1 rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 sm:flex-none"
            >
              ทิ้งไป
            </button>
          </div>
        </div>
      )}

      <section>
        <SectionHeading number="1" title="ประเภทและหมวดหมู่" description="ระบบอาจเติมส่วนนี้จากใบเสร็จ กรุณาตรวจสอบก่อนบันทึก" />
      <div>
        <label className={labelClass}>ประเภทเงิน</label>
        <div className="mt-1 flex gap-2">
          {(["เงินสดย่อย", "เงินทดรองจ่าย"] as FundType[]).map((option) => (
            <button
              type="button"
              key={option}
              onClick={() => {
                set("fundType", option);
                setFundTypeTouched(true);
              }}
              className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-all duration-150 active:scale-95 ${
                form.fundType === option
                  ? "border-emerald-700 bg-emerald-700 text-white"
                  : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 active:bg-zinc-100"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        {pettyCashContext && (
          <p className="mt-1.5 text-xs text-zinc-500">
            ใช้เงินสดย่อยไปแล้ว ฿{formatBaht(pettyCashContext.usedThisMonth)} เดือนนี้ (เหลือ ฿
            {formatBaht(Math.max(pettyCashContext.threshold - pettyCashContext.usedThisMonth, 0))}) — เลือกได้เองหากต้องการเปลี่ยน
          </p>
        )}
      </div>

      {/* 2-up until lg: at the sm breakpoint a third of the row is only
          ~186px, which wrapped "หมวดหมู่" labels to eight lines. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={labelClass}>ประเภทเอกสาร</label>
          <select
            className={inputClass}
            value={form.documentType}
            onChange={(e) => set("documentType", e.target.value as DocumentType)}
          >
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="odoo-category">
            หมวดหมู่ (ตาม Odoo)
          </label>
          <ComboBox
            id="odoo-category"
            className={inputClass}
            options={CATEGORY_OPTIONS}
            value={form.odooCategory}
            onChange={(value) => {
              set("odooCategory", value);
              setCategorySuggestedByAi(false); // the user is reviewing it now, however briefly
              // Category and acc name always pair together — picking a
              // known category (from the dropdown, or auto-matched) fills
              // in its acc name too; accName still stays freely editable.
              const pairedAccName = getAccNameForCategory(value);
              if (pairedAccName) set("accName", pairedAccName);
            }}
            placeholder="พิมพ์เพื่อค้นหา เช่น เดินทาง, อาหาร"
            required
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="acc-name">
            ชื่อบัญชี (Acc name)
          </label>
          <ComboBox
            id="acc-name"
            className={inputClass}
            options={ACC_NAME_OPTIONS}
            value={form.accName}
            onChange={(value) => {
              set("accName", value);
              setCategorySuggestedByAi(false);
            }}
            placeholder="พิมพ์เพื่อค้นหา เช่น สวัสดิการ, ไฟฟ้า"
          />
        </div>
      </div>

      {categorySuggestedByAi && (
        <p className="mt-4 w-full rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          🤖 หมวดหมู่และชื่อบัญชีนี้ระบบแนะนำให้อัตโนมัติจากใบเสร็จ ลองเช็กอีกครั้งให้ชัวร์ก่อนบันทึกนะ
        </p>
      )}

      </section>

      <section className="border-t border-[var(--line)] pt-6">
      <SectionHeading number="2" title="ข้อมูลผู้ขายและเอกสาร" description="กรอกข้อมูลสำคัญบนใบเสร็จให้ครบ" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>ชื่อซัพพลายเออร์ (ไทย)</label>
          <input
            className={inputClass}
            value={form.supplierNameTh}
            onChange={(e) => set("supplierNameTh", e.target.value)}
            required
          />
        </div>
        <div>
          <label className={labelClass}>ชื่อซัพพลายเออร์ (English)</label>
          <input
            className={inputClass}
            value={form.supplierNameEn}
            onChange={(e) => set("supplierNameEn", e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>รายละเอียดค่าใช้จ่าย</label>
        <textarea
          className={inputClass}
          rows={2}
          value={form.expenseDetail}
          onChange={(e) => set("expenseDetail", e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className={labelClass}>วันที่ในบิล</label>
          <input
            type="date"
            className={inputClass}
            value={form.billDate}
            onChange={(e) => set("billDate", e.target.value)}
            onBlur={() => void refreshPettyCashClassification(form.billDate, form.grandTotal)}
            required
          />
        </div>
        <div>
          <label className={labelClass}>เลขที่เอกสาร</label>
          <input
            className={inputClass}
            value={form.documentNumber}
            onChange={(e) => set("documentNumber", e.target.value)}
            required
          />
        </div>
        <div>
          <label className={labelClass}>เลขที่ PO (ถ้ามี)</label>
          <input className={inputClass} value={form.poNumber} onChange={(e) => set("poNumber", e.target.value)} />
        </div>
      </div>

      </section>

      <section className="border-t border-[var(--line)] pt-6">
      <SectionHeading number="3" title="ยอดค่าใช้จ่าย" description={form.hasVat ? "ยอดก่อน VAT จะคำนวณ VAT และยอดรวมให้อัตโนมัติ" : "เอกสารนี้แสดงยอดสุทธิเพียงยอดเดียว"} />
      <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-subtle)] px-3 py-2.5">
        <div>
          <p className="text-sm font-semibold text-[var(--ink)]">เอกสารนี้มี VAT 7%</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">ปิดได้หากบิลแสดงเพียงยอดสุทธิ</p>
        </div>
        <button type="button" role="switch" aria-checked={form.hasVat} aria-label="เอกสารนี้มี VAT 7%" onClick={() => setVatEnabled(!form.hasVat)} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${form.hasVat ? "bg-[var(--brand)]" : "bg-zinc-300"}`}>
          <span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${form.hasVat ? "translate-x-5" : "translate-x-0"}`} />
        </button>
      </div>
      {form.hasVat ? (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass}>จำนวนเงินก่อน VAT</label>
            <input type="text" inputMode="decimal" className={inputClass} value={formatMoneyDisplay(form.amountBeforeVat)} onChange={(e) => handleAmountBeforeVatChange(parseMoneyInput(e.target.value))} onBlur={() => void refreshPettyCashClassification(form.billDate, form.grandTotal)} required />
          </div>
          <div>
            <label className={labelClass}>VAT 7%</label>
            <input type="text" inputMode="decimal" className={inputClass} value={formatMoneyDisplay(form.vatAmount)} onChange={(e) => set("vatAmount", parseMoneyInput(e.target.value))} required />
          </div>
          <div>
            <label className={labelClass}>ยอดรวม (Grand Total)</label>
            <input type="text" inputMode="decimal" className={inputClass} value={formatMoneyDisplay(form.grandTotal)} onChange={(e) => handleGrandTotalChange(parseMoneyInput(e.target.value))} onBlur={() => void refreshPettyCashClassification(form.billDate, form.grandTotal)} required />
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <label className={labelClass}>ยอดสุทธิ / ยอดรวม</label>
          <input type="text" inputMode="decimal" className={inputClass} value={formatMoneyDisplay(form.grandTotal)} onChange={(e) => handleGrandTotalChange(parseMoneyInput(e.target.value))} onBlur={() => void refreshPettyCashClassification(form.billDate, form.grandTotal)} required />
          <p className="mt-1.5 text-xs text-[var(--muted)]">ระบบจะบันทึกยอดก่อน VAT เท่ากับยอดสุทธิ และ VAT เป็น 0 บาท</p>
        </div>
      )}

      </section>

      <section className="border-t border-[var(--line)] pt-6">
        <SectionHeading number="4" title="ใบเสร็จ" description="ถ่ายใหม่หรือเปลี่ยนไฟล์ได้ ข้อมูลที่กรอกไว้จะไม่หาย" />
        <label className={labelClass}>รูปถ่ายใบเสร็จ</label>
        <p className="mt-1 text-xs text-zinc-500">
          ถ่ายรูปหรือแนบไฟล์ใบเสร็จ ระบบจะอ่านและเติมข้อมูลในฟอร์มให้อัตโนมัติ (ตรวจสอบและแก้ไขได้ก่อนบันทึก)
        </p>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <ActionButton
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex-1"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 8a2 2 0 0 1 2-2h1.2a2 2 0 0 0 1.66-.9l.6-.9A2 2 0 0 1 11.1 3h1.8a2 2 0 0 1 1.64.87l.6.9a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
              <circle cx="12" cy="13" r="3.6" />
            </svg>
            ถ่ายรูปใบเสร็จ
          </ActionButton>

          <ActionButton
            variant="secondary"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 border-dashed"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 3v4a1 1 0 0 0 1 1h4" />
              <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
              <path d="M9 15l1.5-2 1.5 1.8L14 12l3 4" />
              <circle cx="9.5" cy="10.5" r="1" />
            </svg>
            แนบไฟล์
          </ActionButton>
        </div>

        {/* Rear-camera-first on mobile: accept + capture opens the camera directly. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null)}
        />
        {/* Regular file/photo picker — also supports PDF, no capture attribute. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          className="hidden"
          onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null)}
        />

        {receiptFile && (
          <div className="mt-3 flex items-center gap-3 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-subtle)] p-3">
            {receiptPreviewUrl ? (
              // A local blob preview is intentionally not optimized by next/image.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={receiptPreviewUrl} alt="ตัวอย่างใบเสร็จที่แนบ" className="h-20 w-16 shrink-0 rounded-lg border border-[var(--line)] bg-white object-cover" />
            ) : (
              <div className="flex h-20 w-16 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-white text-xs font-bold text-[var(--brand)]">PDF</div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--ink)]">{receiptFile.name}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">{ocrLoading ? "กำลังอ่านข้อมูลด้วย OCR..." : "พร้อมแนบกับรายการ"}</p>
              {ocrLoading && <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--line)]"><div className="h-full w-2/3 animate-pulse rounded-full bg-[var(--brand)]" /></div>}
            </div>
            {ocrLoading && <BilliMascot mood="scan" size="sm" className="-mr-1" />}
          </div>
        )}

        {ocrMessage && (
          <p
            className={`mt-2 rounded-md px-3 py-2 text-xs ${
              ocrMessage.type === "success"
                ? "bg-emerald-50 text-emerald-800"
                : ocrMessage.type === "warning"
                  ? "bg-amber-50 text-amber-800"
                  : "bg-red-50 text-red-700"
            }`}
          >
            {ocrMessage.text}
          </p>
        )}
      </section>

      {message && (
        <p
          className={`rounded-md px-3 py-2 text-sm ${
            message.type === "success" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </p>
      )}

      {duplicateMatch && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">รายการนี้อาจซ้ำกับรายการที่มีอยู่แล้ว — กรุณาตรวจสอบก่อนบันทึกต่อ</p>
          <p className="mt-1">
            {duplicateMatch.id} — {duplicateMatch.supplierNameTh || duplicateMatch.supplierNameEn} ฿
            {formatBaht(duplicateMatch.grandTotal)} วันที่ {duplicateMatch.billDate} (สถานะ: {duplicateMatch.status})
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void confirmDuplicateAndSubmit()}
              disabled={submitting}
              className="flex-1 rounded-md bg-red-700 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              ยืนยันบันทึกต่อแม้จะซ้ำ
            </button>
            <button
              type="button"
              onClick={cancelDuplicateWarning}
              disabled={submitting}
              className="flex-1 rounded-md border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100"
            >
              แก้ไขข้อมูลก่อน
            </button>
          </div>
        </div>
      )}

      {!duplicateMatch && (
        <ActionButton
          type="submit"
          disabled={submitting || checkingDuplicate}
          className="sticky bottom-3 z-20 w-full shadow-lg shadow-emerald-950/10 sm:static sm:shadow-none"
        >
          {submitting ? "กำลังบันทึก..." : checkingDuplicate ? "กำลังตรวจสอบรายการซ้ำ..." : "บันทึกรายการ (รอตรวจ)"}
        </ActionButton>
      )}

      {showSuccessDialog && (
        <SuccessDialog
          detail="บันทึกรายการลง Google Sheet แล้ว และส่งเข้ารอตรวจเรียบร้อย"
          primaryLabel="ไปที่ Dashboard"
          onPrimary={() => router.push("/dashboard")}
          onClose={() => setShowSuccessDialog(false)}
        />
      )}
    </form>
  );
}
