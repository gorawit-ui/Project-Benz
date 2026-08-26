"use client";

/**
 * Floating "แจ้งปัญหา / บัค" button — self-contained, drop-in anywhere in
 * the layout. Opens a bottom-sheet/modal where the signed-in user can
 * describe a problem and optionally attach a screenshot; submitting posts
 * to POST /api/report-bug, which relays a formatted message to Slack
 * (see lib/slack.ts) mentioning เบนซ์ so he sees it immediately.
 *
 * Mirrors the mockup in design/ReportBug.dc.html, adapted into real Tailwind.
 */
import { useRef, useState, type FormEvent } from "react";
import { useSession } from "next-auth/react";

type SubmitMessage = { type: "success" | "error"; text: string };

export default function ReportBugButton() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<SubmitMessage | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!session) return null;

  function resetAndClose() {
    setOpen(false);
    setDescription("");
    setScreenshot(null);
    setMessage(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!description.trim()) {
      setMessage({ type: "error", text: "กรุณาอธิบายปัญหาที่เจอ" });
      return;
    }
    setMessage(null);
    setSubmitting(true);
    try {
      const body = new FormData();
      body.append("message", description);
      if (screenshot) {
        body.append("screenshot", screenshot);
      }
      const res = await fetch("/api/report-bug", { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || "ส่งแจ้งปัญหาไม่สำเร็จ");
      }
      setMessage({ type: "success", text: "ส่งแล้ว! เบนซ์จะเห็นข้อความนี้ใน Slack" });
      setDescription("");
      setScreenshot(null);
      setTimeout(() => resetAndClose(), 1600);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "ส่งแจ้งปัญหาไม่สำเร็จ" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="แจ้งปัญหา / บัค"
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-700 text-white shadow-lg transition-all duration-150 hover:bg-emerald-800 active:scale-95 active:bg-emerald-900"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          {/* dimmed backdrop */}
          <div className="absolute inset-0 bg-black/45" onClick={resetAndClose} />

          <form
            onSubmit={handleSubmit}
            className="relative z-10 flex w-full max-w-md flex-col gap-4 rounded-t-2xl bg-white p-6 pb-8 shadow-xl sm:rounded-2xl sm:pb-6"
          >
            {/* drag handle, mobile bottom-sheet affordance */}
            <div className="mx-auto -mt-2 h-1 w-9 rounded-full bg-zinc-200 sm:hidden" />

            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-red-50">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#c0362c"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 9v4M12 17h.01" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
              </div>
              <div>
                <p className="text-base font-semibold text-zinc-900">แจ้งปัญหา / บัค</p>
                <p className="text-xs text-zinc-500">ส่งข้อความไปหาผู้ดูแลระบบทันที</p>
              </div>
              <button
                type="button"
                onClick={resetAndClose}
                aria-label="ปิด"
                className="ml-auto rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2.5">
              <span className="text-xs font-semibold text-zinc-400">ส่งถึง</span>
              <div className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white py-0.5 pl-1 pr-2.5">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-700 text-[9px] font-bold text-white">
                  B
                </div>
                <span className="text-xs font-semibold text-zinc-700">เบนซ์ · Slack</span>
              </div>
            </div>

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={'อธิบายปัญหาที่เจอ เช่น "OCR อ่านยอดเงินผิด" หรือ "กดยืนยันแล้วหน้าจอค้าง"...'}
              rows={4}
              required
              className="w-full resize-none rounded-xl border border-zinc-300 p-3 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-10 items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-zinc-300 text-xs font-semibold text-zinc-600 transition-all duration-150 hover:bg-zinc-50 active:scale-[0.98]"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              {screenshot ? screenshot.name : "แนบภาพหน้าจอ"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)}
            />

            {message && (
              <p
                className={`rounded-md px-3 py-2 text-xs ${
                  message.type === "success" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
                }`}
              >
                {message.text}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex h-[50px] items-center justify-center gap-2 rounded-xl bg-emerald-700 text-sm font-bold text-white transition-all duration-150 hover:bg-emerald-800 active:scale-[0.98] active:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              {submitting ? "กำลังส่ง..." : "ส่งไปที่ Slack"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
