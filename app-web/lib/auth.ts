/**
 * NextAuth (Auth.js) configuration.
 *
 * NOTE on version: this uses next-auth v4's "authOptions" pattern
 * (NextAuth(authOptions) inside a route handler, getServerSession(authOptions)
 * in server code) rather than the v5 `NextAuth()` handlers/`auth()` singleton
 * pattern. v4 was chosen because it is the stable, widely-documented release
 * and its Google-provider + JWT-session flow for this use case (persisting a
 * user's own Google OAuth access token onto the session) is well trodden.
 */
import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import GoogleProvider from "next-auth/providers/google";
import { getTeamForEmail } from "./teams";

const ALLOWED_EMAIL_DOMAIN = "tdfb.co";

// Scopes: openid/email/profile for sign-in, plus the two scopes the app
// needs to act on the signed-in user's own behalf (no shared service
// account in this phase) — full Sheets access, and Drive access limited to
// files the app itself creates/opens (drive.file).
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

/**
 * Exchanges the stored Google refresh_token for a new access_token, since
 * the one issued at sign-in only lasts ~1 hour — without this, every
 * Sheets/Drive call starts failing with "invalid authentication
 * credentials" partway through a normal work session, and the only way out
 * was signing out and back in. Google may or may not issue a new
 * refresh_token on rotation; when it doesn't, the existing one keeps
 * working and must be kept rather than dropped.
 */
async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    if (!token.refreshToken) throw new Error("no refresh token available");

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
    });

    const refreshed = await response.json();
    if (!response.ok) throw refreshed;

    return {
      ...token,
      accessToken: refreshed.access_token,
      accessTokenExpires: Date.now() + refreshed.expires_in * 1000,
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
      error: undefined,
    };
  } catch (err) {
    console.error("refreshAccessToken failed", err);
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          scope: GOOGLE_SCOPES,
          // "offline" so Google issues a refresh_token on the user's FIRST
          // consent (needed since the app relies on the user's own token
          // rather than a shared service account). Deliberately NOT setting
          // prompt: "consent" — that forces Google's "Allow" screen on every
          // single sign-in even after the user already granted access, which
          // is annoying for a tool people open daily. Once consent has been
          // granted once, Google skips straight through on later sign-ins.
          access_type: "offline",
        },
      },
    }),
  ],

  session: {
    strategy: "jwt",
  },

  pages: {
    signIn: "/login",
  },

  callbacks: {
    // Reject sign-in for anyone outside the @tdfb.co Google Workspace domain,
    // AND for anyone not yet bound to a team in lib/teams.ts. During the GM
    // pilot this means only the 3 configured GM emails can sign in at all —
    // every other @tdfb.co account is turned away until its team is added.
    async signIn({ user }) {
      const email = user.email?.toLowerCase() ?? "";
      if (!email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) return false;
      return getTeamForEmail(email) !== null;
    },

    // Persist the Google access token (and refresh token, when present)
    // onto the JWT so server-side code can call Sheets/Drive APIs as this
    // user. Also resolve and persist which team this user belongs to, so
    // every Sheet/Drive/receipt-doc operation downstream scopes itself to
    // that team automatically. Once the short-lived Google access_token
    // (~1 hour) is at or past its expiry, transparently exchanges the
    // refresh_token for a new one via refreshAccessToken rather than
    // leaving every subsequent Sheets/Drive call to fail with "invalid
    // authentication credentials".
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        if (account.refresh_token) {
          token.refreshToken = account.refresh_token;
        }
        token.accessTokenExpires = account.expires_at
          ? account.expires_at * 1000
          : undefined;

        const team = getTeamForEmail(token.email);
        token.team = team ? { key: team.key, name: team.name } : undefined;
        return token;
      }

      if (token.accessTokenExpires && Date.now() < token.accessTokenExpires) {
        return token;
      }

      return refreshAccessToken(token);
    },

    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.accessTokenExpires = token.accessTokenExpires;
      session.error = token.error;
      session.team = token.team;
      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};
