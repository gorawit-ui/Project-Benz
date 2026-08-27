/**
 * Pure Drive-link helpers, kept apart from lib/drive.ts on purpose.
 *
 * lib/drive.ts imports googleapis, which is server-only; a client component
 * that needs just this parsing would otherwise drag the whole SDK into the
 * browser bundle (and fail the build). Nothing here has dependencies.
 */

/**
 * Pulls the Drive file id out of a webViewLink such as
 * "https://drive.google.com/file/d/FILEID/view?usp=drivesdk". Returns null
 * for anything that isn't a recognisable Drive file URL, so callers can fall
 * back to just showing the raw link.
 */
export function driveFileIdFromLink(link: string): string | null {
  if (!link) return null;
  const path = /\/file\/d\/([A-Za-z0-9_-]+)/.exec(link);
  if (path) return path[1];
  const query = /[?&]id=([A-Za-z0-9_-]+)/.exec(link);
  return query ? query[1] : null;
}
