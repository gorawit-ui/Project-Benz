"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { numberToThaiBahtText } from "@/lib/thaiBahtText";
import type { ExpenseRow } from "@/lib/sheets";
import type { PayeeTemplate } from "@/lib/payeeTemplates";
import { formatThaiNationalId } from "@/lib/thaiId";
import ComboBox from "./ComboBox";

export default function ReceiptDocForm({ defaultPayeeName }: { defaultPayeeName: string }) {
  const [payeeName, setPayeeName] = useState(defaultPayeeName);
  const [idNumber, setIdNumber] = useState("");
  const [expenseDetail, setExpenseDetail] = useState("");
  const [amountText, setAmountText] = useState("");
  const [idCardImage, setIdCardImage] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadFilename, setDownloadFilename] = useState<string>("เอกสารรับเงิน.pdf");
  const [driveLink, setDriveLink] = useState<string | null>(null);
  const [bundleLink, setBundleLink] = useState<string | null>(null);
  const [linkedExpenseId, setLinkedExpenseId] = useState<string | null>(null);
  const [driveWarning, setDriveWarning] = useState<string | null>(null);
  const [bundleWarning, setBundleWarning] = useState<string | null>(null);

  // A brief, self-dismissing center-screen toast (e.g. "สร้างเอกสารรับเงินเสร็จแล้ว",
  // "ดาวน์โหลดเอกสารรับเงินแล้ว") — `visible` drives the fade in/out transition,
  // and the toast is only removed from the DOM after the fade-out finishes.
  const [toast, setToast] = useState<{ text: string; visible: boolean } | null>(null);
  const toastTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  function showToast(text: string) {
    toastTimersRef.current.forEach(clearTimeout);
    setToast({ text, visible: true });
    const hideTimer = setTimeout(() => {
      setToast((prev) => (prev ? { ...prev, visible: false } : prev));
      const removeTimer = setTimeout(() => setToast(null), 300);
      toastTimersRef.current.push(removeTimer);
    }, 2200);
    toastTimersRef.current = [hideTimer];
  }

  useEffect(() => {
    return () => toastTimersRef.current.forEach(clearTimeout);
  }, []);

  // รอตรวจ rows this เอกสารรับเงิน can optionally be linked to — see
  // "ผูกกับรายการค่าใช้จ่าย (ถ้ามี)" below. Fetched once on mount; failing to
  // load this list is a convenience miss only, never blocks the form.
  const [pendingRows, setPendingRows] = useState<ExpenseRow[]>([]);
  const [expenseRowId, setExpenseRowId] = useState("");
  // The month tab pendingRows was loaded from — needed so linking back to a
  // row (see /api/receipt-doc's `monthTab` field) writes into the correct
  // per-month sheet tab instead of being silently skipped.
  const [pendingRowsMonth, setPendingRowsMonth] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Saved ผู้รับเงิน (name + ID number + ID-card image). Picking one fills the
  // top of the form so only the description and amount are left to type —
  // re-keying a 13-digit ID and re-shooting the card photo every time was the
  // slowest, most error-prone part of this form.
  const [templates, setTemplates] = useState<PayeeTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<PayeeTemplate | null>(null);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);
  /** Payee whose delete button is armed and awaiting confirmation. */
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null);

  /** Refetches the saved-payee list (after saving one). */
  async function loadTemplates() {
    try {
      const res = await fetch("/api/payee-templates");
      if (!res.ok) return; // convenience only — never blocks the form
      const data = await res.json();
      setTemplates((data.templates ?? []) as PayeeTemplate[]);
    } catch {
      // ignore: the form still works fully without saved templates
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/payee-templates")
      .then((res) => (res.ok ? res.json() : { templates: [] }))
      .then((data) => {
        if (cancelled) return;
        setTemplates((data.templates ?? []) as PayeeTemplate[]);
      })
      .catch(() => {
        // saved payees are a convenience only — leave the picker hidden
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Handles the name field. Typing anything that isn't a saved payee just
   * sets the name; landing exactly on a saved one also fills their ID and
   * switches to their stored card image.
   */
  function handlePayeeNameChange(name: string) {
    setPayeeName(name);
    const match = templates.find((t) => t.payeeName === name) ?? null;
    setSelectedTemplate(match);
    setConfirmDeleteName(null);
    if (!match) return;
    setIdNumber(match.idNumber);
    // Drop any locally-attached file: the saved Drive image is used instead
    // (the server re-reads it by id), and keeping both would be ambiguous.
    setIdCardImage(null);
  }

  /**
   * Removes a saved payee from the picker. Two-step (the button arms, then
   * confirms) because it's destructive and sits right next to the picker —
   * a stray tap should not silently drop someone's saved details.
   *
   * Deletes the sheet entry only: the ID-card image stays in Drive, since
   * removing a file outright is a bigger step than tidying a dropdown and
   * isn't what this button promises.
   */
  async function handleDeleteTemplate(payeeName: string) {
    setTemplateBusy(true);
    setTemplateNotice(null);
    try {
      const res = await fetch(`/api/payee-templates?payeeName=${encodeURIComponent(payeeName)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "ลบไม่สำเร็จ");
      }
      setTemplates((prev) => prev.filter((t) => t.payeeName !== payeeName));
      // Clear the selection if the deleted payee was the one in use, but
      // leave the already-filled fields alone — the user may still be
      // partway through this document.
      setSelectedTemplate((prev) => (prev?.payeeName === payeeName ? null : prev));
      setConfirmDeleteName(null);
      showToast("ลบชื่อออกจากรายการแล้ว 👌");
    } catch (err) {
      setTemplateNotice(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
    } finally {
      setTemplateBusy(false);
    }
  }

  /** Saves the current name/ID/card image for reuse next time. */
  async function handleSaveTemplate() {
    if (!payeeName.trim()) {
      setTemplateNotice("กรอกชื่อผู้รับเงินก่อนบันทึก");
      return;
    }
    setTemplateBusy(true);
    setTemplateNotice(null);
    try {
      const body = new FormData();
      body.append("payeeName", payeeName.trim());
      body.append("idNumber", idNumber.trim());
      if (idCardImage) body.append("idCardImage", idCardImage);
      // Preserve the already-stored image when re-saving without a new file.
      if (selectedTemplate?.payeeName === payeeName.trim()) {
        body.append("existingIdCardFileId", selectedTemplate.idCardFileId);
        body.append("existingIdCardLink", selectedTemplate.idCardLink);
      }
      const res = await fetch("/api/payee-templates", { method: "POST", body });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "บันทึกไม่สำเร็จ");
      }
      const data = await res.json();
      setSelectedTemplate(data.template as PayeeTemplate);
      await loadTemplates();
      showToast("บันทึกไว้แล้ว! ครั้งหน้าเลือกได้เลย 🙌");
    } catch (err) {
      setTemplateNotice(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setTemplateBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/expenses")
      .then((res) => (res.ok ? res.json() : { rows: [], month: null }))
      .then((data) => {
        if (cancelled) return;
        const rows = (data.rows ?? []) as ExpenseRow[];
        setPendingRows(rows.filter((row) => row.documentType === "บิลเงินสด" && !row.receiptDocLink));
        setPendingRowsMonth((data.month as string | undefined) ?? null);
      })
      .catch(() => {
        // listing รอตรวจ rows to link is a convenience only — leave the dropdown empty
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const amountNumber = parseFloat(amountText);
  const bahtText = useMemo(
    () => (Number.isFinite(amountNumber) && amountNumber > 0 ? numberToThaiBahtText(amountNumber) : ""),
    [amountNumber]
  );

  /** Windows/Mac/Linux all disallow these in filenames; strip rather than reject so a stray character never blocks the download. */
  function sanitizeForFilename(value: string): string {
    return value.replace(/[\\/:*?"<>|]/g, "").trim();
  }

  /** compactDocDate is "YYYYMMDD" (e.g. "20260826"), from the server's X-Doc-Date-Compact header. */
  function buildDownloadFilename(compactDocDate: string): string {
    const parts = [payeeName, expenseDetail, `${Math.round(amountNumber)}บาท`, compactDocDate]
      .map((part) => sanitizeForFilename(part))
      .filter(Boolean);
    return parts.length > 0 ? `${parts.join("_")}.pdf` : "เอกสารรับเงิน.pdf";
  }

  const inputClass =
    "mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600";
  const labelClass = "block text-sm font-medium text-zinc-700";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDownloadUrl(null);
    setDriveLink(null);
    setBundleLink(null);
    setLinkedExpenseId(null);
    setDriveWarning(null);
    setBundleWarning(null);
    setSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("payeeName", payeeName);
      formData.append("idNumber", idNumber);
      formData.append("expenseDetail", expenseDetail);
      formData.append("amountNumber", amountText);
      if (idCardImage) formData.append("idCardImage", idCardImage);
      // No fresh photo but a template is in use → let the server pull that
      // payee's stored card image out of Drive by id.
      else if (selectedTemplate?.idCardFileId) {
        formData.append("idCardFileId", selectedTemplate.idCardFileId);
      }
      if (expenseRowId) {
        formData.append("expenseRowId", expenseRowId);
        if (pendingRowsMonth) formData.append("monthTab", pendingRowsMonth);
      }

      const res = await fetch("/api/receipt-doc", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "สร้างเอกสารไม่สำเร็จ");
      }

      // The Drive upload + sheet-link step is additive on the server side and
      // never fails the response — its outcome (if any) rides along as
      // headers next to the PDF bytes so the direct-download path below is
      // completely unaffected.
      const uploadedLink = res.headers.get("X-Drive-Web-View-Link");
      const linkedId = res.headers.get("X-Linked-Expense-Id");
      const compactDocDate = res.headers.get("X-Doc-Date-Compact") ?? "";
      const uploadError = res.headers.get("X-Drive-Upload-Error");
      const evidenceBundleLink = res.headers.get("X-Cash-Bill-Bundle-Link");
      const evidenceBundleError = res.headers.get("X-Cash-Bill-Bundle-Error");

      const blob = await res.blob();
      setDownloadUrl(URL.createObjectURL(blob));
      setDownloadFilename(buildDownloadFilename(compactDocDate));
      if (uploadedLink) setDriveLink(uploadedLink);
      if (linkedId) setLinkedExpenseId(linkedId);
      if (uploadError) setDriveWarning(decodeURIComponent(uploadError));
      if (evidenceBundleLink) setBundleLink(evidenceBundleLink);
      if (evidenceBundleError) setBundleWarning(decodeURIComponent(evidenceBundleError));
      showToast("สร้างเอกสารเสร็จแล้ว! 🎉");
    } catch (err) {
      setError(err instanceof Error ? err.message : "อุ๊ปส์ มีบางอย่างไม่เรียบร้อย 😅 ลองใหม่อีกทีนะ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      {/* The saved-payee picker lives ON the name field rather than in a box
          above it: choosing a saved person IS a way of filling this field, and
          a separate control repeated the name and ID immediately below itself. */}
      <div>
        <label className={labelClass} htmlFor="payee-name">
          ชื่อผู้รับเงิน
        </label>
        <ComboBox
          id="payee-name"
          className={inputClass}
          value={payeeName}
          onChange={handlePayeeNameChange}
          options={templates.map((t) => ({
            value: t.payeeName,
            meta: formatThaiNationalId(t.idNumber),
          }))}
          // A national ID is a detail about the person, not a tag for them —
          // it belongs under the name, the way a contact list reads.
          optionLayout="stacked"
          placeholder="พิมพ์ชื่อ หรือแตะเพื่อเลือกจากที่บันทึกไว้"
          required
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="payee-id">
          เลขประจำตัวประชาชน
        </label>
        <input
          id="payee-id"
          className={inputClass}
          value={idNumber}
          onChange={(e) => setIdNumber(e.target.value)}
          inputMode="numeric"
          required
        />
        {idNumber.replace(/\D/g, "").length === 13 && (
          <p className="mt-1 font-mono text-xs tracking-wide text-zinc-500">
            {formatThaiNationalId(idNumber)}
          </p>
        )}

        {/* Shown only once a saved payee is actually in use: this describes
            the result of picking one, so it belongs with the filled fields. */}
        {selectedTemplate && selectedTemplate.payeeName === payeeName && (
          <>
            {/* Info and action separated: the delete was previously a word
                inside this sentence, which read as prose rather than
                something pressable. */}
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-emerald-700">
                เติมจากชื่อที่บันทึกไว้
                {selectedTemplate.idCardFileId
                  ? " · ใช้รูปบัตรเดิม ไม่ต้องแนบใหม่"
                  : " · ยังไม่มีรูปบัตรที่บันทึกไว้"}
              </p>
              {confirmDeleteName !== selectedTemplate.payeeName && (
                <button
                  type="button"
                  onClick={() => {
                    setTemplateNotice(null);
                    setConfirmDeleteName(selectedTemplate.payeeName);
                  }}
                  title={`ลบ ${selectedTemplate.payeeName} ออกจากรายการที่บันทึกไว้`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                >
                  {/* aria-hidden: the label right beside it already says
                      what this does, so a screen reader announcing
                      "wastebasket" first would just be noise. */}
                  <span aria-hidden="true" className="text-sm leading-none">
                    🗑️
                  </span>
                  ลบชื่อนี้
                </button>
              )}
            </div>

            {confirmDeleteName === selectedTemplate.payeeName && (
              <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2.5">
                <p className="text-xs text-red-800">
                  ลบ &quot;{selectedTemplate.payeeName}&quot; ออกจากรายการที่บันทึกไว้?
                  <span className="mt-0.5 block text-red-600">
                    ข้อมูลที่กรอกในฟอร์มนี้ยังอยู่ · บันทึกใหม่ได้ทุกเมื่อ
                  </span>
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={templateBusy}
                    onClick={() => void handleDeleteTemplate(selectedTemplate.payeeName)}
                    className="flex-1 rounded-md bg-red-700 px-3 py-2 text-xs font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
                  >
                    {templateBusy ? "กำลังลบ..." : "ยืนยันลบ"}
                  </button>
                  <button
                    type="button"
                    disabled={templateBusy}
                    onClick={() => setConfirmDeleteName(null)}
                    className="flex-1 rounded-md border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 sm:flex-none"
                  >
                    ยกเลิก
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {templateNotice && confirmDeleteName === null && (
          <p className="mt-1.5 text-xs text-red-600">{templateNotice}</p>
        )}
      </div>

      <div>
        <label className={labelClass}>ได้รับเงินจากบริษัทเป็นค่า</label>
        <input
          className={inputClass}
          value={expenseDetail}
          onChange={(e) => setExpenseDetail(e.target.value)}
          placeholder="เช่น ซื้ออุปกรณ์ทำความสะอาด ที่ร้าน 7-Eleven"
          required
        />
      </div>

      <div>
        <label className={labelClass}>จำนวนเงิน</label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          className={inputClass}
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          required
        />
        {bahtText && <p className="mt-1 text-sm text-emerald-700">({bahtText})</p>}
      </div>

      <div>
        <label className={labelClass}>รูปสำเนาบัตรประชาชน</label>

        <div className="mt-1 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition-all duration-150 hover:bg-emerald-800 active:scale-[0.98] active:bg-emerald-900"
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
            ถ่ายรูปบัตร
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-zinc-300 bg-white px-4 py-3 text-sm font-semibold text-zinc-700 transition-all duration-150 hover:bg-zinc-50 active:scale-[0.98] active:bg-zinc-100"
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
          </button>
        </div>

        {/* Rear-camera-first on mobile: accept + capture opens the camera directly. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => setIdCardImage(e.target.files?.[0] ?? null)}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => setIdCardImage(e.target.files?.[0] ?? null)}
        />

        {idCardImage && <p className="mt-2 truncate text-xs text-zinc-500">ไฟล์ที่แนบ: {idCardImage.name}</p>}
        {!idCardImage && selectedTemplate?.idCardLink && (
          <p className="mt-2 text-xs text-emerald-700">
            ใช้รูปบัตรที่บันทึกไว้ ·{" "}
            <a
              href={selectedTemplate.idCardLink}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              ดูรูป
            </a>{" "}
            · แนบไฟล์ใหม่ได้ถ้าต้องการเปลี่ยน
          </p>
        )}

        {/* Save this person for next time. Deliberately a button rather than
            an on-submit side effect: storing someone's ID card is not
            something to do silently. */}
        <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <label className="flex items-start gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={saveAsTemplate}
              onChange={(e) => setSaveAsTemplate(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-emerald-600"
            />
            <span>
              บันทึกชื่อ เลขบัตร และรูปบัตรของคนนี้ไว้ใช้ครั้งถัดไป
              <span className="mt-0.5 block text-xs text-zinc-500">
                ครั้งหน้าเลือกจากรายการด้านบนได้เลย ไม่ต้องกรอกใหม่
              </span>
            </span>
          </label>
          {saveAsTemplate && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => void handleSaveTemplate()}
                disabled={templateBusy}
                className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {templateBusy ? "กำลังบันทึก..." : "บันทึกข้อมูลผู้รับเงิน"}
              </button>
              {templateNotice && <p className="text-xs text-red-600">{templateNotice}</p>}
            </div>
          )}
        </div>
      </div>

      <div>
        <label className={labelClass}>ผูกกับบิลเงินสด (ถ้ามี)</label>
        <select className={inputClass} value={expenseRowId} onChange={(e) => setExpenseRowId(e.target.value)}>
          <option value="">ไม่ผูกกับรายการใด</option>
          {pendingRows.map((row) => (
            <option key={row.id} value={row.id}>
              {row.id} — {row.supplierNameTh || row.supplierNameEn || "ไม่ระบุซัพพลายเออร์"} ฿
              {row.grandTotal.toLocaleString("th-TH")} ({row.billDate})
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-zinc-500">
          เมื่อเลือก ระบบจะบันทึกลิงก์เอกสารรับเงินกลับเข้าไปในรายการ และ copy ทั้งบิลเงินสดกับเอกสารรับเงินไว้ในโฟลเดอร์รวมของรายการนั้น
        </p>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-emerald-700 px-4 py-3 font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "กำลังสร้างเอกสาร..." : "สร้างเอกสารรับเงิน (.pdf)"}
      </button>

      {/* Finishing a receipt document is more work than anything else in the
          app, so the payoff gets more than a toast that vanishes. */}
      {downloadUrl && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 text-center">
          <p className="text-3xl">🎉</p>
          <p className="mt-2 text-sm font-semibold text-emerald-900">เอกสารพร้อมแล้ว!</p>
          <p className="mt-1 text-xs text-emerald-700">โหลดเก็บไว้ หรือเปิดดูใน Drive ได้เลย</p>
          <a
            href={downloadUrl}
            download={downloadFilename}
            onClick={() => showToast("ดาวน์โหลดแล้ว 📄")}
            className="mt-4 block w-full rounded-lg bg-emerald-700 px-4 py-3 text-center font-medium text-white transition-colors hover:bg-emerald-800"
          >
            ดาวน์โหลดเอกสารรับเงิน (.pdf)
          </a>
        </div>
      )}

      {toast && (
        <div
          className="pointer-events-none fixed inset-x-0 top-1/3 z-50 flex justify-center px-4"
          aria-live="polite"
        >
          <div
            className={`rounded-full bg-zinc-900/90 px-5 py-2.5 text-sm font-medium text-white shadow-lg transition-all duration-300 ${
              toast.visible ? "translate-y-0 scale-100 opacity-100" : "-translate-y-1 scale-95 opacity-0"
            }`}
          >
            {toast.text}
          </div>
        </div>
      )}

      {driveLink && (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <p>
            อัปโหลดเข้า Drive แล้ว —{" "}
            <a href={driveLink} target="_blank" rel="noopener noreferrer" className="underline">
              เปิดไฟล์ใน Drive
            </a>
          </p>
          {linkedExpenseId && <p className="mt-1">บันทึกลิงก์ในรายการ {linkedExpenseId} แล้ว</p>}
        </div>
      )}

      {bundleLink && (
        <div className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <p>
            จัดชุดบิลเงินสดและเอกสารรับเงินไว้แล้ว —{" "}
            <a href={bundleLink} target="_blank" rel="noopener noreferrer" className="underline">
              เปิดโฟลเดอร์รวม
            </a>
          </p>
        </div>
      )}

      {driveWarning && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p>ดาวน์โหลดเอกสารสำเร็จ แต่อัปโหลดเข้า Drive ไม่สำเร็จ ({driveWarning})</p>
        </div>
      )}

      {bundleWarning && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p>สร้างเอกสารและบันทึกลิงก์แล้ว แต่จัดชุดไฟล์ไม่สำเร็จ ({bundleWarning})</p>
        </div>
      )}
    </form>
  );
}
