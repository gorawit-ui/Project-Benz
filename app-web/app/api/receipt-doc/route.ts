import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { generateReceiptDoc } from "@/lib/receiptDoc";
import { formatThaiBuddhistDate } from "@/lib/thaiDate";

/**
 * POST /api/receipt-doc — accepts multipart form data (payee info + an
 * optional ID card image) and returns the filled "เอกสารรับเงิน" .docx as a
 * file download.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const payeeName = ((formData.get("payeeName") as string) || session.user?.name || "").trim();
  const idNumber = ((formData.get("idNumber") as string) || "").trim();
  const expenseDetail = ((formData.get("expenseDetail") as string) || "").trim();
  const amountNumber = Number(formData.get("amountNumber") ?? NaN);
  const docDate = ((formData.get("docDate") as string) || "").trim() || formatThaiBuddhistDate(new Date());

  if (!payeeName || !idNumber || !expenseDetail || !Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "กรอกข้อมูลให้ครบ: ชื่อผู้รับเงิน, เลขบัตรประชาชน, รายละเอียด, จำนวนเงิน" }, { status: 400 });
  }

  let idCardImageBuffer: Buffer | undefined;
  let idCardImageMimeType: string | undefined;
  const idCardImage = formData.get("idCardImage");
  if (idCardImage instanceof File && idCardImage.size > 0) {
    idCardImageBuffer = Buffer.from(await idCardImage.arrayBuffer());
    idCardImageMimeType = idCardImage.type;
  }

  try {
    const buffer = await generateReceiptDoc({
      payeeName,
      idNumber,
      expenseDetail,
      amountNumber,
      docDate,
      idCardImageBuffer,
      idCardImageMimeType,
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="receipt-doc-${Date.now()}.docx"`,
      },
    });
  } catch (err) {
    console.error("POST /api/receipt-doc failed", err);
    return NextResponse.json({ error: "สร้างเอกสารรับเงินไม่สำเร็จ" }, { status: 500 });
  }
}
