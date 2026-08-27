import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { downloadDriveFile } from "@/lib/drive";

/**
 * GET /api/drive-file/[fileId] — streams a Drive file's bytes through the
 * signed-in user's own token.
 *
 * Receipt images are shown inline in the review list, and Drive's own
 * thumbnail endpoint only works for files shared more broadly than these
 * are. Proxying keeps the files exactly as private as they already are:
 * the request runs as the caller, so anyone who cannot open the file in
 * Drive cannot read it here either.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { fileId } = await params;
  if (!/^[A-Za-z0-9_-]+$/.test(fileId)) {
    return NextResponse.json({ error: "invalid file id" }, { status: 400 });
  }

  try {
    const { buffer, mimeType } = await downloadDriveFile(session.accessToken, fileId);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mimeType,
        // Private: this is one user's receipt, so no shared/CDN caching.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error(`GET /api/drive-file/${fileId} failed`, err);
    return NextResponse.json({ error: "โหลดไฟล์ไม่สำเร็จ" }, { status: 502 });
  }
}
