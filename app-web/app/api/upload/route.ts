import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTeamByKey } from "@/lib/teams";
import { uploadReceiptFile } from "@/lib/drive";
import { formatThaiMonthLabel } from "@/lib/month";

/** Uploading a multi-MB receipt photo to Drive can outrun Vercel's 10s default. */
export const maxDuration = 60;

function extensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "application/pdf":
      return ".pdf";
    default:
      return "";
  }
}

function sanitizeForFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_").trim() || "receipt";
}

/**
 * POST /api/upload — accepts a receipt image/PDF (multipart form field
 * "file", optional "supplierName" used for the Drive filename) and uploads
 * it into this month's Drive folder under the caller's own team's root
 * Drive folder (see lib/teams.ts) — never a folder shared across teams.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const team = getTeamByKey(session.team?.key);
  if (!team?.driveRootFolderId || !team?.sheetId) {
    return NextResponse.json(
      { error: "ยังไม่ได้ตั้งค่าโฟลเดอร์ Google Drive ของทีมนี้" },
      { status: 500 }
    );
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }

  const supplierName = sanitizeForFilename((formData.get("supplierName") as string) || file.name || "receipt");
  const mimeType = file.type || "application/octet-stream";
  const buffer = Buffer.from(await file.arrayBuffer());

  // แยกโฟลเดอร์ตามเดือน (พ.ศ.), e.g. "2569-08 สิงหาคม".
  const monthFolderName = formatThaiMonthLabel(new Date());
  const filename = `${supplierName}-${Date.now()}${extensionForMimeType(mimeType)}`;

  try {
    const result = await uploadReceiptFile(
      session.accessToken,
      team.sheetId,
      team.driveRootFolderId,
      monthFolderName,
      { buffer, mimeType },
      filename
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("POST /api/upload failed", err);
    return NextResponse.json({ error: "อัปโหลดไฟล์ขึ้น Google Drive ไม่สำเร็จ" }, { status: 500 });
  }
}
