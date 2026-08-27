/**
 * Thin wrapper around the Google Drive v3 API. Uses each signed-in user's
 * own OAuth access token (drive.file scope) — files are uploaded under a
 * shared root folder (GOOGLE_DRIVE_ROOT_FOLDER_ID), organized into one
 * subfolder per month, per docs/02-requirements-from-pop.md ("แยกโฟลเดอร์ตามเดือน").
 *
 * Folder lookup goes through a shared registry in the team's Google Sheet
 * (see resolveFolderId below), not a plain Drive `files.list` search —
 * drive.file scope isolates each session's view of Drive to files/folders
 * it created itself, so a name-based search alone would make every team
 * member's session create its own duplicate folder.
 */
import { Readable } from "node:stream";
import { google, drive_v3 } from "googleapis";
import { getDriveFolderId, setDriveFolderId } from "./sheets";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

function driveClient(accessToken: string): drive_v3.Drive {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

/** Escapes a value for safe use inside a Drive `q` search string literal. */
function escapeForDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findOrCreateFolder(
  drive: drive_v3.Drive,
  parentFolderId: string,
  folderName: string
): Promise<string> {
  const safeName = escapeForDriveQuery(folderName);
  const existing = await drive.files.list({
    q: `'${parentFolderId}' in parents and name = '${safeName}' and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`,
    fields: "files(id, name)",
    spaces: "drive",
  });

  const found = existing.data.files?.[0];
  if (found?.id) return found.id;

  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: FOLDER_MIME_TYPE,
      parents: [parentFolderId],
    },
    fields: "id",
  });

  if (!created.data.id) {
    throw new Error(`สร้างโฟลเดอร์ "${folderName}" ใน Drive ไม่สำเร็จ`);
  }
  return created.data.id;
}

/**
 * Resolves `folderName`'s Drive folder ID, preferring the shared registry in
 * the team's Google Sheet (see lib/sheets.ts's getDriveFolderId) over Drive's
 * own `files.list` search. This matters because of `drive.file` OAuth scope:
 * each user's session can only see Drive files/folders IT created (or the
 * user explicitly opened with it) — a folder one teammate's session created
 * is invisible to another teammate's `files.list` query even though both
 * share the same Drive root folder, so without the registry every team
 * member's first upload of a given folder silently created its own
 * duplicate. The registry sidesteps that entirely: any session that already
 * knows the ID (because some earlier session — anyone's — registered it)
 * uses it directly with no Drive-side search at all. Only the very first
 * time a folder name is ever needed does this fall back to the old
 * find-or-create-on-Drive path, then records the result for everyone else.
 */
async function resolveFolderId(
  drive: drive_v3.Drive,
  accessToken: string,
  sheetId: string,
  parentFolderId: string,
  folderName: string
): Promise<string> {
  const registered = await getDriveFolderId(accessToken, sheetId, folderName);
  if (registered) return registered;

  const folderId = await findOrCreateFolder(drive, parentFolderId, folderName);
  await setDriveFolderId(accessToken, sheetId, folderName, folderId);
  return folderId;
}

export interface UploadedFile {
  fileId: string;
  /** A link a signed-in user with access to the file can open. */
  webViewLink: string;
}

export interface FileToUpload {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Finds (or creates) `monthFolderName` under `rootFolderId`, uploads `file`
 * there as `filename`, and returns a shareable link. Sharing relies on the
 * root folder's own permissions (set up by whoever owns
 * GOOGLE_DRIVE_ROOT_FOLDER_ID) — this function does not itself grant any
 * new permissions, since the app only holds drive.file-scoped access.
 *
 * Uploads the file as-is (no explicit Google Docs conversion request). An
 * earlier version of this function requested Drive convert .docx uploads
 * into a native Google Doc, on the theory that Drive's inline preview of a
 * raw .docx used a weaker renderer than an actual Google Doc — but a
 * fully-converted Google Doc turned out to show the exact same
 * one-character-per-line garbling, which traced back to a missing
 * `columnWidths` on the .docx's own tables (see receiptDoc.ts), not to
 * which Drive rendering path was used. Since that's now fixed at the
 * source, requesting conversion here would only add a real failure mode —
 * a conversion request can be rejected outright — for no remaining benefit.
 */
export async function uploadReceiptFile(
  accessToken: string,
  sheetId: string,
  rootFolderId: string,
  monthFolderName: string,
  file: FileToUpload,
  filename: string
): Promise<UploadedFile> {
  const drive = driveClient(accessToken);
  const folderId = await resolveFolderId(drive, accessToken, sheetId, rootFolderId, monthFolderName);

  const uploaded = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType: file.mimeType,
      body: Readable.from(file.buffer),
    },
    fields: "id, webViewLink",
  });

  if (!uploaded.data.id) {
    throw new Error(`อัปโหลดไฟล์ "${filename}" ไม่สำเร็จ`);
  }

  return {
    fileId: uploaded.data.id,
    webViewLink:
      uploaded.data.webViewLink ??
      `https://drive.google.com/file/d/${uploaded.data.id}/view`,
  };
}

/**
 * Fetches a Drive file's bytes. Used to pull a saved ID-card image back out
 * when a เอกสารรับเงิน is created from a payee template — the template keeps
 * only the file id, so the image itself is re-read from Drive at generation
 * time rather than being copied around or re-uploaded by the browser.
 */
export async function downloadDriveFile(
  accessToken: string,
  fileId: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const drive = driveClient(accessToken);
  const meta = await drive.files.get({ fileId, fields: "mimeType" });
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return {
    buffer: Buffer.from(res.data as ArrayBuffer),
    mimeType: meta.data.mimeType ?? "image/jpeg",
  };
}
