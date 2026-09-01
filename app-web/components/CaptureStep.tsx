"use client";

/**
 * The first screen after login: just "ถ่ายรูปใบเสร็จ" / "แนบไฟล์", matching
 * the original design/Main.dc.html mockup. Picking a file here hands it to
 * the parent (CaptureFlow), which switches to ExpenseForm — OCR runs there
 * (ExpenseForm triggers it automatically for an `initialFile`), so this
 * component owns capture only, not any OCR/form logic.
 */
import { useRef, useState } from "react";
import { ActionButton, PageShell, Surface } from "./ui";
import { MAX_BATCH_FILES, getBatchFileCountError } from "@/lib/batchFileLimit";

export default function CaptureStep({
  onFileSelected,
  onSkip,
}: {
  onFileSelected: (files: File[]) => void;
  onSkip: () => void;
}) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const countError = getBatchFileCountError(files.length);
    if (countError) {
      setError(countError);
      return;
    }
    setError(null);
    onFileSelected(files);
  }

  return (
    <PageShell className="max-w-lg">
      <div className="mb-6 pt-2 text-center sm:pt-6">
      <p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--brand)]">New expense</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--ink)]">เริ่มจากใบเสร็จ</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">
        ถ่ายรูปหรือแนบไฟล์ใบเสร็จ ระบบจะอ่านและเติมข้อมูลในฟอร์มให้อัตโนมัติ
      </p>
      </div>

      <Surface className="p-4 sm:p-5">
      <div className="flex w-full flex-col gap-3">
        <ActionButton
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          className="min-h-14 text-base"
        >
          <svg
            width="20"
            height="20"
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
          className="min-h-14 border-dashed text-base"
        >
          <svg
            width="20"
            height="20"
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

        {/* Rear-camera-first on mobile: accept + capture opens the camera directly. */}
        <input
          ref={cameraInputRef}
          type="file"
          multiple
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleChange}
        />
        {/* Regular file/photo picker — also supports PDF, no capture attribute. */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,application/pdf"
          className="hidden"
          onChange={handleChange}
        />
      </div>

      <p className="mt-4 text-center text-xs font-semibold leading-5 text-[var(--ink)]">
        แนบไฟล์ได้สูงสุด {MAX_BATCH_FILES} ไฟล์ต่อครั้ง
      </p>
      <p className="mt-1 text-center text-xs leading-5 text-[var(--muted)]">รองรับ JPEG, PNG และ PDF · เลือกหลายไฟล์ได้ ตรวจข้อมูล OCR ทีละบิลก่อนบันทึก</p>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-center text-xs text-red-700">
          {error}
        </p>
      )}
      </Surface>

      <ActionButton
        variant="ghost"
        type="button"
        onClick={onSkip}
        className="mx-auto mt-4 flex"
      >
        กรอกข้อมูลเอง (ไม่มีรูป)
      </ActionButton>
    </PageShell>
  );
}
