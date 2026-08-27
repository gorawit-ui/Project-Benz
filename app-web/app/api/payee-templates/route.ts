import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTeamByKey } from "@/lib/teams";
import { uploadReceiptFile } from "@/lib/drive";
import {
  listPayeeTemplates,
  savePayeeTemplate,
  deletePayeeTemplate,
  type PayeeTemplate,
} from "@/lib/payeeTemplates";

/** Drive subfolder the saved ID-card images live in. */
const ID_CARD_FOLDER = "บัตรประชาชน (Template)";

async function requireTeamSheet() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken || !session.user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  }
  const team = getTeamByKey(session.team?.key);
  if (!team?.sheetId) {
    return {
      error: NextResponse.json({ error: "ยังไม่ได้ตั้งค่า Google Sheet ของทีมนี้" }, { status: 500 }),
    } as const;
  }
  return { session, team } as const;
}

/** GET /api/payee-templates — saved ผู้รับเงิน for the picker. */
export async function GET() {
  const ctx = await requireTeamSheet();
  if ("error" in ctx) return ctx.error;

  try {
    const templates = await listPayeeTemplates(ctx.session.accessToken!, ctx.team.sheetId!);
    return NextResponse.json({ templates });
  } catch (err) {
    console.error("GET /api/payee-templates failed", err);
    return NextResponse.json({ error: "โหลดรายชื่อที่บันทึกไว้ไม่สำเร็จ" }, { status: 500 });
  }
}

/**
 * POST /api/payee-templates — save (or overwrite) one payee's details.
 * Multipart, because the ID-card image rides along; the image goes to Drive
 * and only its file id is recorded in the sheet.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireTeamSheet();
  if ("error" in ctx) return ctx.error;
  const { session, team } = ctx;

  const formData = await req.formData();
  const payeeName = ((formData.get("payeeName") as string) || "").trim();
  const idNumber = ((formData.get("idNumber") as string) || "").trim();

  if (!payeeName) {
    return NextResponse.json({ error: "กรุณาระบุชื่อผู้รับเงิน" }, { status: 400 });
  }

  // Keep whatever image the caller already had saved when no new file is sent,
  // so editing just the ID number doesn't silently drop the card photo.
  let idCardFileId = ((formData.get("existingIdCardFileId") as string) || "").trim();
  let idCardLink = ((formData.get("existingIdCardLink") as string) || "").trim();

  try {
    const idCardImage = formData.get("idCardImage");
    if (idCardImage && typeof idCardImage !== "string" && idCardImage.size > 0) {
      if (!team.driveRootFolderId) {
        return NextResponse.json(
          { error: "ยังไม่ได้ตั้งค่าโฟลเดอร์ Google Drive ของทีมนี้" },
          { status: 500 }
        );
      }
      const buffer = Buffer.from(await idCardImage.arrayBuffer());
      const extension = idCardImage.name.includes(".") ? idCardImage.name.split(".").pop() : "jpg";
      const uploaded = await uploadReceiptFile(
        session.accessToken!,
        team.sheetId!,
        team.driveRootFolderId,
        ID_CARD_FOLDER,
        { buffer, mimeType: idCardImage.type || "image/jpeg" },
        `บัตรประชาชน-${payeeName}.${extension}`
      );
      idCardFileId = uploaded.fileId;
      idCardLink = uploaded.webViewLink;
    }

    const template: PayeeTemplate = {
      payeeName,
      idNumber,
      idCardFileId,
      idCardLink,
      savedAt: new Date().toISOString(),
      savedBy: session.user?.name ?? session.user?.email ?? "",
    };
    await savePayeeTemplate(session.accessToken!, team.sheetId!, template);
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    console.error("POST /api/payee-templates failed", err);
    return NextResponse.json({ error: "บันทึกข้อมูลผู้รับเงินไม่สำเร็จ" }, { status: 500 });
  }
}

/** DELETE /api/payee-templates?payeeName=... — remove one saved payee. */
export async function DELETE(req: NextRequest) {
  const ctx = await requireTeamSheet();
  if ("error" in ctx) return ctx.error;

  const payeeName = (req.nextUrl.searchParams.get("payeeName") || "").trim();
  if (!payeeName) {
    return NextResponse.json({ error: "missing payeeName" }, { status: 400 });
  }

  try {
    await deletePayeeTemplate(ctx.session.accessToken!, ctx.team.sheetId!, payeeName);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/payee-templates failed", err);
    return NextResponse.json({ error: "ลบข้อมูลผู้รับเงินไม่สำเร็จ" }, { status: 500 });
  }
}
