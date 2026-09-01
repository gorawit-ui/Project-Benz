"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { DocumentType, FundType } from "@/lib/sheets";
import type { ExtractedReceiptData } from "@/lib/ocr";
import { getAccNameForCategory, matchCategoryAndAccName } from "@/lib/categoryMapping";
import { ActionButton, PageShell, SectionHeading, Surface } from "./ui";
import BilliMascot from "./BilliMascot";
import SuccessDialog from "./SuccessDialog";

const DOCUMENT_TYPES: DocumentType[] = ["ใบเสร็จรับเงิน", "ใบกำกับภาษี", "บิลเงินสด", "บิลทางด่วน", "สลิป Grab"];
const VAT_RATE = 0.07;

type FormState = {
  fundType: FundType;
  documentType: DocumentType;
  documentNumber: string;
  poNumber: string;
  billDate: string;
  supplierNameTh: string;
  supplierNameEn: string;
  expenseDetail: string;
  odooCategory: string;
  accName: string;
  amountBeforeVat: string;
  vatAmount: string;
  grandTotal: string;
  hasVat: boolean;
};

type Entry = {
  key: string;
  file: File;
  form: FormState;
  ocrState: "loading" | "done" | "warning";
  ocrText: string;
};

const emptyForm = (): FormState => ({
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
});

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function formatMoney(value: string) {
  if (!value) return "";
  const [integer, decimal] = value.split(".");
  const formatted = Number(integer || 0).toLocaleString("en-US");
  return decimal === undefined ? formatted : formatted + "." + decimal;
}

function parseMoney(value: string) {
  return value.replace(/,/g, "").replace(/[^\d.]/g, "");
}

function isEntryComplete(entry: Entry) {
  const { form } = entry;
  return Boolean(
    form.documentNumber.trim() &&
      form.billDate &&
      form.supplierNameTh.trim() &&
      form.expenseDetail.trim() &&
      form.odooCategory.trim() &&
      (!form.hasVat || (Number(form.amountBeforeVat) >= 0 && Number(form.vatAmount) >= 0)) &&
      Number(form.grandTotal) > 0
  );
}

function ocrPatch(data: ExtractedReceiptData): Partial<FormState> {
  const patch: Partial<FormState> = {};
  if (data.documentType) patch.documentType = data.documentType;
  if (data.documentNumber) patch.documentNumber = data.documentNumber;
  if (data.billDate) patch.billDate = data.billDate;
  if (data.supplierNameTh) patch.supplierNameTh = data.supplierNameTh;
  if (data.supplierNameEn) patch.supplierNameEn = data.supplierNameEn;
  if (data.expenseDetail) patch.expenseDetail = data.expenseDetail;
  if (data.amountBeforeVat !== undefined) patch.amountBeforeVat = String(data.amountBeforeVat);
  if (data.vatAmount !== undefined) patch.vatAmount = String(data.vatAmount);
  if (data.grandTotal !== undefined) patch.grandTotal = String(data.grandTotal);

  // A receipt with just one total and no VAT signal (for example a DBD fee)
  // is not a VAT invoice. Keep the screen simple, while still supplying the
  // fixed A:Z Sheet columns on save: before VAT = total and VAT = 0.
  if (data.grandTotal !== undefined && data.amountBeforeVat === undefined && data.vatAmount === undefined) {
    patch.hasVat = false;
    patch.amountBeforeVat = String(data.grandTotal);
    patch.vatAmount = "0";
  } else if (data.amountBeforeVat !== undefined || data.vatAmount !== undefined) {
    patch.hasVat = true;
  }

  const vendor = data.supplierNameTh || data.supplierNameEn || "";
  const matched = matchCategoryAndAccName(vendor, data.expenseDetail || "");
  if (matched) {
    patch.odooCategory = matched.category;
    patch.accName = matched.accName;
  } else {
    if (data.suggestedCategory) patch.odooCategory = data.suggestedCategory;
    if (data.suggestedAccName) patch.accName = data.suggestedAccName;
  }

  if (data.amountBeforeVat !== undefined && data.vatAmount === undefined && data.grandTotal === undefined) {
    const vat = round2(data.amountBeforeVat * VAT_RATE);
    patch.vatAmount = String(vat);
    patch.grandTotal = String(round2(data.amountBeforeVat + vat));
  }
  return patch;
}

export default function BatchExpenseForm({ files }: { files: File[] }) {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>(() =>
    files.map((file, index) => ({
      key: String(index) + "-" + file.name + "-" + file.lastModified,
      file,
      form: emptyForm(),
      ocrState: "loading",
      ocrText: "กำลังอ่านข้อมูลจากเอกสาร...",
    }))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  useEffect(() => {
    entries.forEach((entry) => {
      void (async () => {
        try {
          const payload = new FormData();
          payload.append("file", entry.file);
          const res = await fetch("/api/ocr", { method: "POST", body: payload });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error || "อ่านข้อมูลไม่ได้");
          const data = (json.data ?? {}) as ExtractedReceiptData;
          setEntries((current) => current.map((item) =>
            item.key === entry.key
              ? {
                  ...item,
                  form: { ...item.form, ...ocrPatch(data) },
                  ocrState: data.confidence === "low" ? "warning" : "done",
                  ocrText: data.confidence === "low" ? "อ่านได้ไม่ชัด กรุณาตรวจทานก่อนบันทึก" : "OCR อ่านข้อมูลแล้ว กรุณาตรวจทานและแก้ไขได้",
                }
              : item
          ));
        } catch (cause) {
          setEntries((current) => current.map((item) =>
            item.key === entry.key
              ? { ...item, ocrState: "warning", ocrText: cause instanceof Error ? cause.message + " — กรอกข้อมูลเองได้" : "อ่านข้อมูลไม่ได้ — กรอกข้อมูลเองได้" }
              : item
          ));
        }
      })();
    });
    // files are fixed when entering this page; each entry must be OCR'd once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(key: string, patch: Partial<FormState>) {
    setEntries((current) => current.map((entry) => entry.key === key ? { ...entry, form: { ...entry.form, ...patch } } : entry));
  }

  function updateBeforeVat(key: string, value: string) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      update(key, { amountBeforeVat: value });
      return;
    }
    const vat = round2(numeric * VAT_RATE);
    update(key, { amountBeforeVat: value, vatAmount: String(vat), grandTotal: String(round2(numeric + vat)) });
  }

  function updateGrandTotal(key: string, value: string) {
    setEntries((current) => current.map((entry) => {
      if (entry.key !== key) return entry;
      return {
        ...entry,
        form: entry.form.hasVat
          ? { ...entry.form, grandTotal: value }
          : { ...entry.form, amountBeforeVat: value, vatAmount: "0", grandTotal: value },
      };
    }));
  }

  function setVatEnabled(key: string, hasVat: boolean) {
    setEntries((current) => current.map((entry) => {
      if (entry.key !== key) return entry;
      if (hasVat) return { ...entry, form: { ...entry.form, hasVat: true } };
      const total = entry.form.grandTotal || entry.form.amountBeforeVat;
      return {
        ...entry,
        form: { ...entry.form, hasVat: false, amountBeforeVat: total, vatAmount: "0", grandTotal: total },
      };
    }));
  }

  async function upload(entry: Entry): Promise<string> {
    const payload = new FormData();
    payload.append("file", entry.file);
    payload.append("supplierName", entry.form.supplierNameEn || entry.form.supplierNameTh || entry.file.name);
    const res = await fetch("/api/upload", { method: "POST", body: payload });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "อัปโหลดไฟล์ขึ้น Google Drive ไม่สำเร็จ");
    return String(json.webViewLink || "");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const receiptFileLinks = await Promise.all(entries.map(upload));
      const res = await fetch("/api/expenses/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: entries.map((entry, index) => ({
            ...entry.form,
            amountBeforeVat: entry.form.hasVat ? Number(entry.form.amountBeforeVat) : Number(entry.form.grandTotal),
            vatAmount: entry.form.hasVat ? Number(entry.form.vatAmount) : 0,
            grandTotal: Number(entry.form.grandTotal),
            receiptFileLink: receiptFileLinks[index],
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "บันทึกชุดเอกสารไม่สำเร็จ");
      setSavedCount(Number(json.rows?.length) || entries.length);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "บันทึกชุดเอกสารไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";
  const labelClass = "block text-xs font-semibold text-slate-700";
  const completeCount = entries.filter(isEntryComplete).length;
  const incompleteCount = entries.length - completeCount;
  const batchTotal = entries.reduce((sum, entry) => sum + (Number(entry.form.grandTotal) || 0), 0);
  const ocrCompletedCount = entries.filter((entry) => entry.ocrState !== "loading").length;
  const ocrCurrentFile = entries.find((entry) => entry.ocrState === "loading")?.file.name;

  return (
    <>
    <PageShell>
      <p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--brand)]">Batch expense entry</p>
      <h1 className="mt-1 text-2xl font-bold text-[var(--ink)]">ตรวจข้อมูล {entries.length} เอกสารก่อนบันทึก</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        OCR อ่านเอกสารทุกใบแล้ว ให้ตรวจและแก้ข้อมูลของแต่ละบิลก่อนกดบันทึกครั้งเดียว ระบบจะอัปโหลดทั้งหมดและบันทึกเป็นรายการแยกบิล โดยผ่านอัตโนมัติ
      </p>

      <form onSubmit={submit} className="mt-6 space-y-5">
        {entries.map((entry, index) => (
          <Surface key={entry.key} className="p-4 sm:p-6">
            <SectionHeading number={String(index + 1)} title={entry.file.name} description={entry.ocrText} />
            <div className={`mb-3 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${isEntryComplete(entry) ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
              {isEntryComplete(entry) ? "พร้อมบันทึก" : "ยังมีข้อมูลที่ต้องตรวจ"}
            </div>
            <p className={"mt-3 rounded-lg px-3 py-2 text-xs " + (entry.ocrState === "done" ? "bg-emerald-50 text-emerald-800" : entry.ocrState === "loading" ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-900")}>
              {entry.ocrState === "loading" ? "กำลัง OCR..." : entry.ocrState === "done" ? "OCR สำเร็จ — ตรวจข้อมูลก่อนส่ง" : "OCR ต้องตรวจทานเพิ่มเติม — ยังแก้ไขและส่งได้"}
            </p>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className={labelClass}>ประเภทเอกสาร
                <select className={inputClass} value={entry.form.documentType} onChange={(e) => update(entry.key, { documentType: e.target.value as DocumentType })}>
                  {DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <label className={labelClass}>วันที่ในบิล
                <input required type="date" className={inputClass} value={entry.form.billDate} onChange={(e) => update(entry.key, { billDate: e.target.value })} />
              </label>
              <label className={labelClass}>เลขที่เอกสาร
                <input required className={inputClass} value={entry.form.documentNumber} onChange={(e) => update(entry.key, { documentNumber: e.target.value })} />
              </label>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={labelClass}>ชื่อซัพพลายเออร์ (ไทย)
                <input required className={inputClass} value={entry.form.supplierNameTh} onChange={(e) => update(entry.key, { supplierNameTh: e.target.value })} />
              </label>
              <label className={labelClass}>ชื่อซัพพลายเออร์ (English)
                <input className={inputClass} value={entry.form.supplierNameEn} onChange={(e) => update(entry.key, { supplierNameEn: e.target.value })} />
              </label>
            </div>

            <label className={"mt-3 " + labelClass}>รายละเอียดค่าใช้จ่าย
              <textarea required rows={2} className={inputClass} value={entry.form.expenseDetail} onChange={(e) => update(entry.key, { expenseDetail: e.target.value })} />
            </label>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={labelClass}>หมวดหมู่ (ตาม Odoo)
                <input required className={inputClass} value={entry.form.odooCategory} onChange={(e) => {
                  const value = e.target.value;
                  update(entry.key, { odooCategory: value, ...(getAccNameForCategory(value) ? { accName: getAccNameForCategory(value) } : {}) });
                }} />
              </label>
              <label className={labelClass}>ชื่อบัญชี (Acc name)
                <input className={inputClass} value={entry.form.accName} onChange={(e) => update(entry.key, { accName: e.target.value })} />
              </label>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-subtle)] px-3 py-2.5">
              <div>
                <p className="text-xs font-semibold text-[var(--ink)]">เอกสารนี้มี VAT 7%</p>
                <p className="mt-0.5 text-[11px] text-[var(--muted)]">ปิดได้หากบิลแสดงเพียงยอดสุทธิ</p>
              </div>
              <button type="button" role="switch" aria-checked={entry.form.hasVat} aria-label="เอกสารนี้มี VAT 7%" onClick={() => setVatEnabled(entry.key, !entry.form.hasVat)} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${entry.form.hasVat ? "bg-emerald-700" : "bg-slate-300"}`}>
                <span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${entry.form.hasVat ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>

            {entry.form.hasVat ? (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className={labelClass}>ก่อน VAT
                  <input required inputMode="decimal" className={inputClass} value={formatMoney(entry.form.amountBeforeVat)} onChange={(e) => updateBeforeVat(entry.key, parseMoney(e.target.value))} />
                </label>
                <label className={labelClass}>VAT 7%
                  <input required inputMode="decimal" className={inputClass} value={formatMoney(entry.form.vatAmount)} onChange={(e) => update(entry.key, { vatAmount: parseMoney(e.target.value) })} />
                </label>
                <label className={labelClass}>ยอดรวม
                  <input required inputMode="decimal" className={inputClass} value={formatMoney(entry.form.grandTotal)} onChange={(e) => updateGrandTotal(entry.key, parseMoney(e.target.value))} />
                </label>
              </div>
            ) : (
              <div className="mt-3">
                <label className={labelClass}>ยอดสุทธิ / ยอดรวม
                  <input required inputMode="decimal" className={inputClass} value={formatMoney(entry.form.grandTotal)} onChange={(e) => updateGrandTotal(entry.key, parseMoney(e.target.value))} />
                </label>
                <p className="mt-1 text-[11px] text-[var(--muted)]">ระบบจะบันทึกยอดก่อน VAT เท่ากับยอดสุทธิ และ VAT เป็น 0 บาท</p>
              </div>
            )}

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={labelClass}>ประเภทเงิน
                <select className={inputClass} value={entry.form.fundType} onChange={(e) => update(entry.key, { fundType: e.target.value as FundType })}>
                  <option value="เงินสดย่อย">เงินสดย่อย</option>
                  <option value="เงินทดรองจ่าย">เงินทดรองจ่าย</option>
                </select>
              </label>
              <label className={labelClass}>เลขที่ PO (ถ้ามี)
                <input className={inputClass} value={entry.form.poNumber} onChange={(e) => update(entry.key, { poNumber: e.target.value })} />
              </label>
            </div>
          </Surface>
        ))}

        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
        <div className="sticky bottom-3 z-20 rounded-2xl border border-[var(--line)] bg-white/95 p-3 shadow-xl backdrop-blur sm:static sm:shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3 text-sm">
            <div>
              <p className="font-semibold text-[var(--ink)]">ตรวจครบแล้ว {completeCount}/{entries.length} บิล</p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">ยอดรวมโดยประมาณ ฿{batchTotal.toLocaleString("th-TH", { maximumFractionDigits: 2 })}</p>
            </div>
            {incompleteCount > 0 && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">เหลือ {incompleteCount} บิล</span>}
          </div>
          <ActionButton type="submit" disabled={submitting || incompleteCount > 0 || entries.some((entry) => entry.ocrState === "loading")} className="w-full">
            {submitting ? "กำลังอัปโหลดและบันทึก..." : incompleteCount > 0 ? `ตรวจข้อมูลให้ครบอีก ${incompleteCount} บิล` : "บันทึกทั้งหมดและผ่านอัตโนมัติ"}
          </ActionButton>
        </div>
      </form>

      {savedCount !== null && (
        <SuccessDialog
          title="บันทึกสำเร็จแล้ว"
          detail={"อัปโหลดและบันทึก " + savedCount + " บิลลง Google Sheet แล้ว สถานะเป็น “ตรวจแล้ว” กำลังพาไปหน้า Dashboard"}
          primaryLabel="ไปที่ Dashboard ตอนนี้"
          onPrimary={() => router.push("/dashboard")}
          autoRedirectSeconds={2}
        />
      )}
    </PageShell>
    {ocrCompletedCount < entries.length && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-5 backdrop-blur-sm" role="status" aria-live="polite">
        <div className="w-full max-w-sm rounded-2xl border border-white/70 bg-white p-6 text-center shadow-2xl">
          <BilliMascot mood="scan" size="md" className="mx-auto" />
          <h2 className="mt-4 text-lg font-bold text-[var(--ink)]">กำลังอ่านเอกสาร</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">อ่านแล้ว {ocrCompletedCount} จาก {entries.length} ใบ</p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-emerald-100" role="progressbar" aria-valuemin={0} aria-valuemax={entries.length} aria-valuenow={ocrCompletedCount}>
            <div className="h-full rounded-full bg-emerald-700 transition-all duration-500" style={{ width: `${(ocrCompletedCount / entries.length) * 100}%` }} />
          </div>
          <p className="mt-4 text-sm text-[var(--ink)]">ระบบกำลังดึงข้อมูลจาก OCR รอสักครู่นะครับ</p>
          {ocrCurrentFile && <p className="mt-1 truncate text-xs text-[var(--muted)]">{ocrCurrentFile}</p>}
        </div>
      </div>
    )}
    </>
  );
}
