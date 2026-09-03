import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { extractReceiptData } from "@/lib/ocr";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "application/pdf"];

/**
 * Vercel kills a function at 10s by default, and a Gemini vision call on a
 * phone photo routinely takes longer than that — the request died mid-call,
 * the browser got a 504 whose body isn't JSON, and the form was left empty
 * with a generic "อ่านข้อมูลไม่สำเร็จ". 60s is the Hobby-plan ceiling.
 */
export const maxDuration = 60;

/**
 * POST /api/ocr — accepts a receipt image/PDF (multipart form field "file")
 * and returns the fields Gemini could extract from it, for ExpenseForm to
 * prefill. This is purely a read/extract step: it never touches the
 * Sheet/Drive — /api/upload (unchanged) still handles the actual receipt
 * file upload on submit.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "ไม่พบไฟล์ที่แนบมา" }, { status: 400 });
  }

  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return NextResponse.json(
      { error: "รองรับเฉพาะไฟล์ JPEG, PNG หรือ PDF เท่านั้น" },
      { status: 400 }
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const data = await extractReceiptData(buffer, mimeType);
    return NextResponse.json({ data });
  } catch (err) {
    console.error("POST /api/ocr failed", err);
    return NextResponse.json({ error: "อ่านข้อมูลจากใบเสร็จไม่สำเร็จ กรุณากรอกข้อมูลเอง" }, { status: 500 });
  }
}
