/**
 * Thin wrapper around the Google Drive v3 API. Uses each signed-in user's
 * own OAuth access token (drive.file scope) — files are uploaded under a
 * shared root folder (GOOGLE_DRIVE_ROOT_FOLDER_ID), organized into one
 * subfolder per month, per docs/02-requirements-from-pop.md ("แยกโฟลเดอร์ตามเดือน").
 */
import { Readable } from "node:stream";
import { google, drive_v3 } from "googleapis";

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
 */
export async function uploadReceiptFile(
  accessToken: string,
  rootFolderId: string,
  monthFolderName: string,
  file: FileToUpload,
  filename: string
): Promise<UploadedFile> {
  const drive = driveClient(accessToken);
  const folderId = await findOrCreateFolder(drive, rootFolderId, monthFolderName);

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
