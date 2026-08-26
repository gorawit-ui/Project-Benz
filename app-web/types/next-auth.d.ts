import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    /** The signed-in user's own Google OAuth access token (Sheets + Drive scopes). */
    accessToken?: string;
    accessTokenExpires?: number;
    /** Which team (see lib/teams.ts) this user is bound to — resolves the Sheet/Drive to use. */
    team?: { key: string; name: string };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    team?: { key: string; name: string };
  }
}
