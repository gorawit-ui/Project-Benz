"use client";

import { useEffect } from "react";

export default function SuccessDialog({
  title = "บันทึกสำเร็จแล้ว",
  detail,
  onClose,
  primaryLabel,
  onPrimary,
  autoRedirectSeconds,
}: {
  title?: string;
  detail: string;
  onClose?: () => void;
  primaryLabel?: string;
  onPrimary?: () => void;
  autoRedirectSeconds?: number;
}) {
  useEffect(() => {
    if (!autoRedirectSeconds || !onPrimary) return;
    const timer = window.setTimeout(onPrimary, autoRedirectSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [autoRedirectSeconds, onPrimary]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4" role="dialog" aria-modal="true" aria-labelledby="save-success-title">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 id="save-success-title" className="mt-4 text-xl font-bold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
        {primaryLabel && onPrimary && (
          <button type="button" onClick={onPrimary} className="mt-5 min-h-11 w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2">
            {primaryLabel}
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} className="mt-2 min-h-11 w-full rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            ปิด
          </button>
        )}
      </div>
    </div>
  );
}
