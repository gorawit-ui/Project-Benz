"use client";

/**
 * The first screen after login: just "ถ่ายรูปใบเสร็จ" / "แนบไฟล์", matching
 * the original design/Main.dc.html mockup. Picking a file here hands it to
 * the parent (CaptureFlow), which switches to ExpenseForm — OCR runs there
 * (ExpenseForm triggers it automatically for an `initialFile`), so this
 * component owns capture only, not any OCR/form logic.
 */
import { useRef } from "react";

export default function CaptureStep({
  onFileSelected,
  onSkip,
}: {
  onFileSelected: (file: File) => void;
  onSkip: () => void;
}) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFileSelected(file);
    e.target.value = "";
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-12 text-center">
      <h1 className="text-xl font-bold text-emerald-900">แนบใบเสร็จ</h1>
      <p className="mt-2 text-sm text-zinc-500">
        ถ่ายรูปหรือแนบไฟล์ใบเสร็จ ระบบจะอ่านและเติมข้อมูลในฟอร์มให้อัตโนมัติ
      </p>
      <p className="mt-1 text-xs text-zinc-400">รองรับ: ใบเสร็จรับเงิน, ใบกำกับภาษี, สลิปโอนเงิน (jpeg, png, pdf)</p>

      <div className="mt-8 flex w-full flex-col gap-3">
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          className="flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-4 text-base font-semibold text-white transition-all duration-150 hover:bg-emerald-800 active:scale-[0.98] active:bg-emerald-900"
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
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-zinc-300 bg-white px-4 py-4 text-base font-semibold text-zinc-700 transition-all duration-150 hover:bg-zinc-50 active:scale-[0.98] active:bg-zinc-100"
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
        </button>

        {/* Rear-camera-first on mobile: accept + capture opens the camera directly. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleChange}
        />
        {/* Regular file/photo picker — also supports PDF, no capture attribute. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          className="hidden"
          onChange={handleChange}
        />
      </div>

      <button
        type="button"
        onClick={onSkip}
        className="mt-6 text-sm font-medium text-zinc-500 underline decoration-zinc-300 underline-offset-4 transition-colors hover:text-emerald-700"
      >
        กรอกข้อมูลเอง (ไม่มีรูป)
      </button>
    </div>
  );
}
