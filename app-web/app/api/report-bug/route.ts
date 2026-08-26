import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTeamByKey } from "@/lib/teams";
import { uploadReceiptFile } from "@/lib/drive";
import { notifyBug, SlackNotConfiguredError } from "@/lib/slack";

const BUG_REPORT_DRIVE_SUBFOLDER = "แจ้งบัค";

const ALLOWED_SCREENSHOT_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function extensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    default:
      return "";
  }
}

/**
 * POST /api/report-bug — accepts a bug description (multipart form field
 * "message") and an optional screenshot ("screenshot"), uploads the
 * screenshot into the caller's team's Drive folder (see lib/teams.ts) if
 * present, then posts a formatted notification to Slack via lib/slack.ts.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const message = ((formData.get("message") as string) || "").trim();
  if (!message) {
    return NextResponse.json({ error: "กรุณาอธิบายปัญหาที่เจอ" }, { status: 400 });
  }

  const screenshot = formData.get("screenshot");
  let screenshotFile: File | null = null;
  if (screenshot instanceof File && screenshot.size > 0) {
    const mimeType = screenshot.type || "";
    if (!ALLOWED_SCREENSHOT_MIME_TYPES.has(mimeType)) {
      return NextResponse.json({ error: "ไฟล์ที่แนบต้องเป็นรูปภาพเท่านั้น" }, { status: 400 });
    }
    screenshotFile = screenshot;
  }

  try {
    let screenshotLink: string | undefined;

    if (screenshotFile) {
      const team = getTeamByKey(session.team?.key);
      if (!team?.driveRootFolderId || !team?.sheetId) {
        return NextResponse.json(
          { error: "ยังไม่ได้ตั้งค่าโฟลเดอร์ Google Drive ของทีมนี้" },
          { status: 500 }
        );
      }

      const mimeType = screenshotFile.type || "application/octet-stream";
      const buffer = Buffer.from(await screenshotFile.arrayBuffer());
      const filename = `bug-${Date.now()}${extensionForMimeType(mimeType)}`;

      // All bug-report screenshots go into one flat "แจ้งบัค" subfolder
      // (uploadReceiptFile only creates a single level, so unlike /api/upload
      // this isn't further split by month — bug report volume is low).
      const uploaded = await uploadReceiptFile(
        session.accessToken,
        team.sheetId,
        team.driveRootFolderId,
        BUG_REPORT_DRIVE_SUBFOLDER,
        { buffer, mimeType },
        filename
      );
      screenshotLink = uploaded.webViewLink;
    }

    await notifyBug({
      message,
      reporterName: session.user?.name || session.user?.email || "ไม่ทราบชื่อ",
      reporterEmail: session.user?.email || "",
      screenshotLink,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/report-bug failed", err);
    if (err instanceof SlackNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    return NextResponse.json({ error: "ส่งแจ้งปัญหาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
