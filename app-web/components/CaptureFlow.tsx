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
import BatchExpenseForm from "./BatchExpenseForm";
import { ActionButton, PageShell } from "./ui";

export default function CaptureFlow({ recordedByName }: { recordedByName: string }) {
  const [step, setStep] = useState<"capture" | "form">("capture");
  const [initialFiles, setInitialFiles] = useState<File[]>([]);

  if (step === "capture") {
    return (
      <CaptureStep
        onFileSelected={(files) => {
          setInitialFiles(files);
          setStep("form");
        }}
        onSkip={() => {
          setInitialFiles([]);
          setStep("form");
        }}
      />
    );
  }

  if (initialFiles.length > 1) {
    return <BatchExpenseForm files={initialFiles} />;
  }

  return (
    <PageShell>
      <ActionButton
        variant="ghost"
        type="button"
        onClick={() => {
          setInitialFile(null);
          setStep("capture");
        }}
        className="-ml-3 mb-3"
      >
        ← ถ่ายรูปใหม่ / เริ่มใหม่
      </ActionButton>
      <p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--brand)]">Expense entry</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight text-[var(--ink)]">บันทึกค่าใช้จ่าย</h1>
      <p className="mt-1.5 text-sm leading-6 text-[var(--muted)]">
        ตรวจสอบข้อมูลที่อ่านได้ (หรือกรอกเอง) แล้วบันทึกเข้าสถานะ &ldquo;รอตรวจ&rdquo;
      </p>
      <div className="mt-5">
        <ExpenseForm recordedByName={recordedByName} initialFile={initialFiles[0] ?? null} />
      </div>
    </PageShell>
  );
}
