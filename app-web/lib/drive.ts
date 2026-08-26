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
 * `convertToGoogleDoc` (only meaningful for a .docx `file`) requests that
 * Drive convert the upload into a native Google Doc instead of storing the
 * raw .docx bytes. This matters because Drive's INLINE PREVIEW of a raw
 * .docx (what "เปิดไฟล์ใน Drive" shows without this flag) uses a much
 * weaker/older rendering path than an actual Google Doc — one that garbles
 * complex tab-stop/dot-leader layouts into one-character-per-line text,
 * even though the underlying .docx bytes are completely correct (downloads
 * of the same file, direct or from Drive, always open fine in Word/WPS).
 * Converting on upload sidesteps that renderer entirely; the app's own
 * direct-download response is untouched either way.
 */
export async function uploadReceiptFile(
  accessToken: string,
  sheetId: string,
  rootFolderId: string,
  monthFolderName: string,
  file: FileToUpload,
  filename: string,
  convertToGoogleDoc = false
): Promise<UploadedFile> {
  const drive = driveClient(accessToken);
  const folderId = await resolveFolderId(drive, accessToken, sheetId, rootFolderId, monthFolderName);

  const uploaded = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
      ...(convertToGoogleDoc ? { mimeType: "application/vnd.google-apps.document" } : {}),
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
