/**
 * Team routing config.
 *
 * Maps a logged-in user's email to a team. Every downstream resource
 * (Google Sheet, Drive root folder, receipt-doc generation) is scoped to
 * the caller's team — nothing is shared across teams.
 *
 * To onboard a new team: add an entry below with its own Sheet ID / Drive
 * folder ID (as env vars) and member emails. No other code needs to change —
 * lib/sheets.ts, lib/drive.ts and the API routes all resolve the target
 * Sheet/Drive folder from the session's team, not from a global env var.
 */

export interface TeamConfig {
  key: string;
  /** Display name shown in the UI. */
  name: string;
  /** Odoo cost center code for this team, if known (see docs/02-requirements-from-pop.md). */
  costCenter?: string;
  /** Google Sheet ID this team's expense rows are synced to. */
  sheetId: string;
  /** Google Drive folder ID this team's receipt files/docs are uploaded under. */
  driveRootFolderId: string;
  /** Emails allowed to sign in as this team (lowercase). */
  members: string[];
}

const TEAMS: TeamConfig[] = [
  {
    key: "gm",
    name: "General Management (GM)",
    costCenter: "TD050100",
    sheetId: process.env.GM_SHEET_ID ?? "",
    driveRootFolderId: process.env.GM_DRIVE_ROOT_FOLDER_ID ?? "",
    members: ["gorawit@tdfb.co", "sirirat@tdfb.co", "napat@tdfb.co"],
  },
  {
    key: "hr",
    name: "Human Resources (HR)",
    sheetId: process.env.HR_SHEET_ID ?? "",
    driveRootFolderId: process.env.HR_DRIVE_ROOT_FOLDER_ID ?? "",
    members: ["wiparat@tdfb.co", "naruemol@tdfb.co", "nattapon@tdfb.co"],
  },
  // Add the next team here, e.g.:
  // {
  //   key: "marketing",
  //   name: "Marketing",
  //   sheetId: process.env.MARKETING_SHEET_ID ?? "",
  //   driveRootFolderId: process.env.MARKETING_DRIVE_ROOT_FOLDER_ID ?? "",
  //   members: ["someone@tdfb.co"],
  // },
];

/** Looks up which team an email belongs to. Returns null if the email isn't a member of any configured team. */
export function getTeamForEmail(email: string | null | undefined): TeamConfig | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  return TEAMS.find((t) => t.members.includes(normalized)) ?? null;
}

export function getTeamByKey(key: string | null | undefined): TeamConfig | null {
  if (!key) return null;
  return TEAMS.find((t) => t.key === key) ?? null;
}
