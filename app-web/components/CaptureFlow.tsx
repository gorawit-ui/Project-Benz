"use client";

/**
 * Two-step capture flow for the "/" page: CaptureStep (just the two big
 * buttons) first, then ExpenseForm once a file is picked — or immediately
 * if the user chooses "กรอกข้อมูลเอง (ไม่มีรูป)". NavBar stays mounted above
 * this in app/layout.tsx regardless of which step is showing.
 */
import { useState } from "react";
import CaptureStep from "./CaptureStep";
import ExpenseForm from "./ExpenseForm";

export default function CaptureFlow({ recordedByName }: { recordedByName: string }) {
  const [step, setStep] = useState<"capture" | "form">("capture");
  const [initialFile, setInitialFile] = useState<File | null>(null);

  if (step === "capture") {
    return (
      <CaptureStep
        onFileSelected={(file) => {
          setInitialFile(file);
          setStep("form");
        }}
        onSkip={() => {
          setInitialFile(null);
          setStep("form");
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <button
        type="button"
        onClick={() => {
          setInitialFile(null);
          setStep("capture");
        }}
        className="mb-3 text-sm font-medium text-zinc-500 transition-colors hover:text-emerald-700"
      >
        ← ถ่ายรูปใหม่ / เริ่มใหม่
      </button>
      <h1 className="text-xl font-bold text-emerald-900">บันทึกค่าใช้จ่าย</h1>
      <p className="mt-1 text-sm text-zinc-500">
        ตรวจสอบข้อมูลที่อ่านได้ (หรือกรอกเอง) แล้วบันทึกเข้าสถานะ &ldquo;รอตรวจ&rdquo;
      </p>
      <div className="mt-6">
        <ExpenseForm recordedByName={recordedByName} initialFile={initialFile} />
      </div>
    </div>
  );
}
