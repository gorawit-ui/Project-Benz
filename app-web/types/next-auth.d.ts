import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    /** The signed-in user's own Google OAuth access token (Sheets + Drive scopes). */
    accessToken?: string;
    accessTokenExpires?: number;
    /** Set when refreshing an expired accessToken failed (e.g. the refresh_token was revoked) — the client should force a re-sign-in rather than keep using a dead accessToken. */
    error?: string;
    /** Which team (see lib/teams.ts) this user is bound to — resolves the Sheet/Drive to use. */
    team?: { key: string; name: string };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    error?: string;
    team?: { key: string; name: string };
  }
}
