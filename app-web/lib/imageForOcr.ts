/**
 * Shrinks a receipt photo before it's sent to /api/ocr.
 *
 * Two reasons, both of which were breaking OCR in production:
 *
 *  1. Vercel rejects any request body over 4.5 MB at the infrastructure
 *     level (413 FUNCTION_PAYLOAD_TOO_LARGE — not something the route can
 *     raise). A modern phone camera easily produces a 4-12 MB JPEG, so
 *     photographing a receipt could fail before the handler ever ran.
 *  2. Upload time and Gemini's own processing both scale with the image, so
 *     a full-resolution photo is a large part of why OCR felt slow.
 *
 * This ONLY affects the copy handed to OCR. The original file is what still
 * gets uploaded to Drive as the receipt evidence — accounting needs the
 * untouched original, so nothing here may be reused for that path.
 *
 * MAX_EDGE is generous for the job: Gemini tiles vision input at far lower
 * resolution than this, and receipts are high-contrast text, so 1600px on
 * the long edge reads the same as the original while being roughly an order
 * of magnitude smaller.
 */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

/** Image types worth re-encoding. PDFs and anything else pass through untouched. */
const DOWNSCALABLE_TYPES = ["image/jpeg", "image/png"];

/**
 * Whether `prepareImageForOcr` will try to shrink this file at all — pure, so
 * the decision is testable without a DOM. A PDF must never be re-encoded as
 * an image, and a file already under the threshold isn't worth the round trip
 * through a canvas.
 */
export function shouldDownscaleForOcr(file: { type: string; size: number }, thresholdBytes = 1_000_000): boolean {
  return DOWNSCALABLE_TYPES.includes(file.type) && file.size > thresholdBytes;
}

/**
 * Returns a smaller JPEG copy of `file` suitable for OCR, or the original
 * file when shrinking isn't applicable or fails for any reason.
 *
 * Never throws: OCR degrading to "send the original and hope it fits" is far
 * better than blocking capture entirely, and every failure path here is one
 * the browser can hit legitimately (no canvas support, a decode error, a
 * revoked bitmap).
 */
export async function prepareImageForOcr(file: File): Promise<File> {
  if (!shouldDownscaleForOcr(file)) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    // Already small enough in pixel terms (a big file that's simply a
    // low-compression scan) — re-encoding at full size still shrinks it.
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], file.name.replace(/\.(png|jpe?g)$/i, "") + ".jpg", {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    // Any browser-side failure: fall back to sending the original.
    return file;
  }
}
