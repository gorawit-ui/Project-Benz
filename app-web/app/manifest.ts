import type { MetadataRoute } from "next";

/**
 * Web app manifest — lets staff "Add to Home Screen" and get a full-screen
 * app (no browser address bar), which matters because the day-to-day job
 * here is photographing a receipt on a phone in the field.
 *
 * Next.js serves this at /manifest.webmanifest and links it automatically.
 * Icons are served from public/ rather than the app/icon.png convention
 * because that one is content-hashed per build, and a manifest icon URL
 * should stay stable across deploys.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TDFB Expense Tracking",
    short_name: "TDFB Expense",
    description: "ระบบบันทึกและติดตามค่าใช้จ่าย TDFB",
    lang: "th",
    start_url: "/",
    display: "standalone",
    background_color: "#fafafa", // matches the app's zinc-50 body
    theme_color: "#065f46", // emerald-800, the brand colour used in the nav
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Separate maskable copy: Android crops icons to its own shape, so the
      // art is inset into the safe zone here to avoid losing the leaf's edges.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
