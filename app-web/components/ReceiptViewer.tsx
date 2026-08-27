"use client";

import { useEffect, useState } from "react";
import { driveFileIdFromLink } from "@/lib/driveLinks";

/**
 * Receipt thumbnail + full-screen viewer for a row's Drive file.
 *
 * Reviewers previously had to leave the page for Drive to see what they were
 * approving, which is the one thing they most need to look at — and with
 * bulk approve that round trip is the slowest part of the job. The thumbnail
 * is loaded through /api/drive-file so the files stay as private as they are
 * in Drive.
 *
 * Non-images (a PDF bill) can't be thumbnailed, so those fall back to a
 * labelled button straight out to Drive rather than showing a broken frame.
 */
export default function ReceiptViewer({ link, label = "ใบเสร็จ" }: { link: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const fileId = driveFileIdFromLink(link);
  const src = fileId ? `/api/drive-file/${fileId}` : null;

  // Escape closes the viewer, and the page behind it must not scroll while
  // it's open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // No usable file id, or the bytes aren't an image we can render.
  if (!src || failed) {
    return (
      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
      >
        <FileIcon />
        เปิดไฟล์ใน Drive
      </a>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={`ดู${label}`}
          className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- proxied
              Drive bytes, not a static asset the Image optimiser can handle */}
          <img
            src={src}
            alt={label}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
            onError={() => setFailed(true)}
          />
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/25">
            <span className="opacity-0 transition-opacity group-hover:opacity-100">
              <ZoomIcon />
            </span>
          </span>
        </button>
        <div className="min-w-0 text-xs">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="block font-medium text-emerald-700 underline-offset-2 hover:underline"
          >
            ดู{label}
          </button>
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="block text-zinc-400 underline-offset-2 hover:text-zinc-600 hover:underline"
          >
            เปิดใน Drive
          </a>
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/80"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={label}
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
            <span className="truncate text-sm font-medium">{label}</span>
            <div className="flex shrink-0 items-center gap-2">
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="rounded-md bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25"
              >
                เปิดใน Drive
              </a>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="ปิด"
                className="rounded-md bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25"
              >
                ปิด
              </button>
            </div>
          </div>
          {/* Stop propagation so clicking the image itself doesn't close it,
              while clicking the backdrop still does. */}
          <div className="flex-1 overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
            <img src={src} alt={label} className="mx-auto max-h-full max-w-full object-contain" />
          </div>
        </div>
      )}
    </>
  );
}

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinejoin="round" />
      <path d="M14 2v6h6" strokeLinejoin="round" />
    </svg>
  );
}

function ZoomIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
      <path d="M11 8v6M8 11h6" strokeLinecap="round" />
    </svg>
  );
}
