# TDFB Expense Tracking — app-web

Next.js (App Router, TypeScript, Tailwind CSS) scaffold for the TDFB expense-tracking
app. No database — the Google Sheet described in
[`docs/03-data-schema.md`](../docs/03-data-schema.md) (built by
[`templates/sheet/build_expense_tracking_sheet.py`](../templates/sheet/build_expense_tracking_sheet.py))
is the data store, and receipts/attachments live in Google Drive. Every
read/write happens with the signed-in user's own Google OAuth token — there
is no shared service account in this phase. **Odoo is not integrated** —
that is explicitly out of scope for this whole project phase.

## Setup

### 1. Install dependencies

```bash
cd app-web
npm install
```

### 2. Google OAuth client

In [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials:

1. Create an **OAuth client ID** of type "Web application" (or reuse one for the `tdfb.co` Workspace).
2. Add an authorized redirect URI: `http://localhost:3000/api/auth/callback/google` (and your production URL's equivalent).
3. Enable the **Google Sheets API** and **Google Drive API** for the project.
4. Under OAuth consent screen scopes, the app requests (in code, via `lib/auth.ts` — nothing to configure manually beyond enabling the APIs):
   - `openid`, `email`, `profile`
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/drive.file`
5. Copy the generated Client ID / Client Secret into your `.env.local`.

### 3. Environment variables

```bash
cp .env.example .env.local
```

Fill in:

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From the OAuth client above |
| `NEXTAUTH_SECRET` | Random string, e.g. `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `http://localhost:3000` in dev |
| `GM_SHEET_ID` | The GM team's "Expense Tracking" Google Sheet id (from its URL) — see [Team routing](#team-routing) |
| `GM_DRIVE_ROOT_FOLDER_ID` | Drive folder GM's receipts/documents are uploaded under (month subfolders are created automatically inside it) |
| `GEMINI_API_KEY` | Gemini API key for OCR receipt reading, from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (same Google Cloud project as OAuth, no new project needed) |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL for the "แจ้งปัญหา/บัค" report-a-bug button — see [Slack webhook setup](#slack-webhook-setup-for-แจ้งปัญหาบัค) below |
| `SLACK_MENTION_USER_ID` | Optional — Slack member ID to @-mention (เบนซ์) in every bug report, from that person's Slack profile → "..." → "Copy member ID" |

Sign-in is restricted to `@tdfb.co` emails **that are also a member of a configured team** in `lib/auth.ts`'s `signIn` callback — everyone else is rejected (see below).

## Team routing

Every team gets its own Google Sheet and Drive folder — nothing is shared across teams. `lib/teams.ts` maps `email → team → {sheetId, driveRootFolderId}`; on sign-in, `lib/auth.ts` resolves the caller's team from their email and stores it on the session (`session.team`). Every API route (`/api/expenses`, `/api/upload`, ...) then reads/writes the *caller's own team's* Sheet/Drive — never a hardcoded global one.

Currently only **GM (General Management)** is configured, for the pilot:

```ts
{
  key: "gm",
  name: "General Management (GM)",
  costCenter: "TD050100",
  sheetId: process.env.GM_SHEET_ID,
  driveRootFolderId: process.env.GM_DRIVE_ROOT_FOLDER_ID,
  members: ["gorawit@tdfb.co", "sirirat@tdfb.co", "napat@tdfb.co"],
}
```

Any `@tdfb.co` email **not** listed in a team's `members` is turned away at sign-in (shown as "อีเมลนี้ยังไม่ได้รับสิทธิ์เข้าใช้งาน" on `/login`) — this is intentional for the pilot, not a bug.

**To onboard a new team**: add an entry to the `TEAMS` array in `lib/teams.ts` (team key, display name, member emails) and its own `<TEAM>_SHEET_ID` / `<TEAM>_DRIVE_ROOT_FOLDER_ID` env vars — no other code changes needed. If the number of teams grows large, this static list is a natural candidate to move to a small admin UI or a config sheet, but a hardcoded list is the right amount of engineering for 1 team / 3 users.

### Slack webhook setup (for "แจ้งปัญหา/บัค")

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch** → name it (e.g. `[BOT] แจ้งปัญหา Expense Tracking`) → pick the workspace.
2. **Incoming Webhooks** → Activate → **Add New Webhook to Workspace** → choose a channel → copy the generated Webhook URL into `SLACK_WEBHOOK_URL`.
3. Under **Display Information**, set the app name/icon to how it should appear when posting.
4. Optional: to @-mention เบนซ์ (or whoever owns triage) in every report, get his Slack member ID (his profile → "..." → "Copy member ID") and set `SLACK_MENTION_USER_ID`.

### 4. Run

```bash
npm run dev
```

Visit `http://localhost:3000` — you'll be redirected to `/login` if not signed in.

## Deploy to Vercel

Plan: deploy on **Vercel** now for the GM pilot; migrate to **Google Cloud Run** in September once the app is functionally complete (see note at the end of this section — nothing here locks the code into Vercel-only APIs, so that move is a hosting change, not a rewrite).

**GM pilot live URL:** https://tdfb-expense-tracking.vercel.app/ — deployed, but `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are still placeholders pending Google Cloud access (owned by an executive account — see the "รอคำตอบจากป๊อป"-style blockers in [`docs/04-open-items.md`](../docs/04-open-items.md)). The Login page renders; actual Google sign-in isn't functional until those two are replaced with real values and the deployment's `/api/auth/callback/google` URL is registered as an authorized redirect URI.

1. **Push to GitHub** — already done, this repo (`gorawit-ui/Project-Benz`) is the source.
2. **Vercel → Add New Project → Import** this GitHub repo.
3. **Root Directory — the one setting that's easy to miss**: this repo has `app-web/` as a subfolder, not the Next.js app at the repo root. In the import screen (or later under Project Settings → General → Root Directory), set it to `app-web`. Framework Preset auto-detects as Next.js once that's set.
4. **Environment Variables** (Project Settings → Environment Variables) — add everything from `.env.example` *except* `NEXTAUTH_URL` for now:
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `NEXTAUTH_SECRET`
   - `GM_SHEET_ID`, `GM_DRIVE_ROOT_FOLDER_ID`
5. **Deploy.** Vercel assigns a URL like `https://project-benz.vercel.app` (or set a custom domain under Project Settings → Domains first, if one is ready).
6. **Register that URL with Google OAuth** — back in Google Cloud Console → Credentials → your OAuth client → Authorized redirect URIs, add:
   `https://<your-vercel-url>/api/auth/callback/google`
7. **Set `NEXTAUTH_URL`** in Vercel's env vars to `https://<your-vercel-url>` (no trailing slash), then redeploy (Deployments → ⋯ → Redeploy) so it picks up the new var.
8. **Test sign-in** with one of the 3 configured GM emails (`lib/teams.ts`) — anyone else should be turned away per [Team routing](#team-routing).

**Plan note (commercial use):** Vercel's free **Hobby** tier is licensed for personal/non-commercial projects — for an internal company tool, the **Pro** plan (~$20/mo/seat) is the correct one to be compliant with Vercel's terms.

**Cloud Run migration (September, after the app is functionally complete):** this app doesn't use any Vercel-only primitive (no Edge Config, no Vercel KV, no Vercel Blob) — it's a standard Next.js app, so the move is: containerize with a `Dockerfile` (Next.js's official [standalone output](https://nextjs.org/docs/app/api-reference/next-config-js/output) mode is the usual approach), push to Artifact Registry, deploy to Cloud Run, carry over the same env vars, and re-point the OAuth client's authorized redirect URI at the new URL. Not done yet — deliberately deferred, see the plan above.

## What's implemented

- **Auth**: Google sign-in via NextAuth v4, restricted to `@tdfb.co` AND to configured team members only, requesting Sheets + Drive scopes, access token persisted on the session (`lib/auth.ts`, `types/next-auth.d.ts`).
- **`lib/teams.ts`**: email → team routing (see [Team routing](#team-routing)) — every Sheet/Drive read-write is scoped to the caller's own team, never shared across teams. Only GM (3 pilot emails) is configured so far.
- **`lib/sheets.ts`**: `ExpenseRow` type + `COLUMN_HEADERS` matching the 25-column schema exactly (column order mirrors `templates/sheet/build_expense_tracking_sheet.py`'s `groups`), plus `appendExpenseRow`, `listExpenseRows`, `updateExpenseRowStatus`, `updateExpenseRowReceiptDocLink` (all match rows by "รหัสรายการ", not row position).
- **`lib/drive.ts`**: `uploadReceiptFile` — finds-or-creates a month subfolder under `GOOGLE_DRIVE_ROOT_FOLDER_ID`, uploads, returns a link.
- **`lib/pettyCash.ts` / `GET /api/expenses/petty-cash-status`**: เงินสดย่อย-vs-เงินทดรองจ่าย auto-classification per the product owner's confirmed rule (docs/02-requirements-from-pop.md, "กติกาอัตโนมัติ" — resolves the split-billing open question: a bill is never split). `sumPettyCashForMonth`/`getPettyCashUsedThisMonth` sum every existing เงินสดย่อย row's grand total for the new bill's calendar month (นับสะสม ไม่เรียงวันที่); the whole new bill is classified เงินสดย่อย only if `used + amount <= 20000` (`PETTY_CASH_MONTHLY_THRESHOLD`), otherwise the whole bill is เงินทดรองจ่าย. `ExpenseForm` calls the API right after OCR reads a bill date + total (auto-selecting the fund-type toggle) and again on blur of the date/amount fields for manual entry, showing a "ใช้เงินสดย่อยไปแล้ว ฿X เดือนนี้ (เหลือ ฿Y)" note — the toggle stays a default, never a lock, so a manual click always wins from then on.
- **`lib/duplicateCheck.ts`**: `findDuplicateExpense` — flags an existing row when ชื่อบริษัท (vendor, normalized) + จำนวนเงิน + วันที่เอกสาร all match exactly, per docs/02-requirements-from-pop.md ("การแจ้งเตือนรายการซ้ำ"). `ExpenseForm`'s submit handler runs this against the current sheet rows before appending; a match blocks the save and shows a red warning box naming the matching row (id/vendor/amount/date/status) with an explicit "ยืนยันบันทึกต่อแม้จะซ้ำ" confirmation required before the row is actually written — the `แจ้งเตือนรายการซ้ำ` column is populated with a short note (`อาจซ้ำกับ EX-...`) when confirmed, blank otherwise. No duplicate means normal, frictionless submission.
- **`lib/receiptDoc.ts`**: `generateReceiptDoc(...)` — ported from `templates/receipt-doc/build.js`, same TDFB header/title/body/footer structure and `id_card_photo` bookmark, now parameterized with real data instead of template tags.
- **`POST /api/receipt-doc` → Drive + sheet link**: after generating the .docx, the route also uploads a copy to Drive via `uploadReceiptFile` into a dedicated `เอกสารรับเงิน` subfolder under the team's `driveRootFolderId`, and — if the form's optional "ผูกกับรายการค่าใช้จ่าย" dropdown had a รอตรวจ row selected — writes the resulting link into that row's `ลิงก์เอกสารรับเงิน` column via `updateExpenseRowReceiptDocLink`. Both are additive: they ride along as response headers (`X-Drive-Web-View-Link`, `X-Linked-Expense-Id`) next to the .docx bytes, and any failure there is logged but never blocks the direct-download response, which behaves exactly as before. `ReceiptDocForm` surfaces the result as "อัปโหลดเข้า Drive แล้ว" (+ link) and, if linked, "บันทึกลิงก์ในรายการ EX-XXXX แล้ว".
- **`lib/thaiBahtText.ts`**: `numberToThaiBahtText(amount)` — real Thai digit-reading algorithm (หน่วย/สิบ/ร้อย/พัน/หมื่น/แสน/ล้าน, เอ็ด/ยี่ special cases), verified against the spec's examples (202 → "สองร้อยสองบาทถ้วน", 1250 → "หนึ่งพันสองร้อยห้าสิบบาทถ้วน").
- **`lib/ocr.ts` / `POST /api/ocr`**: OCR / AI receipt reading via the Gemini API (`@google/genai`, model `gemini-2.5-flash`) with structured JSON output (`responseMimeType`/`responseSchema`, not prompt-and-hope). Takes a photographed/scanned receipt (JPEG/PNG/PDF) and extracts document type, supplier name (TH/EN), expense detail, bill date, document number, and the three amount fields — converting Thai Buddhist-Era dates (พ.ศ.) to Gregorian and back-calculating VAT from the grand total when it isn't itemized separately. Fields it can't read confidently are left absent rather than guessed, and it self-reports a `high`/`medium`/`low` confidence. `ExpenseForm`'s camera/file-attach buttons call this route and prefill the form (all fields stay editable) — OCR failure degrades to manual entry, it never blocks submission.
- **`lib/slack.ts` / `POST /api/report-bug`**: "แจ้งปัญหา/บัค" report-a-bug feature — `notifyBug(...)` posts a formatted `mrkdwn` message to a Slack Incoming Webhook (`SLACK_WEBHOOK_URL`), optionally @-mentioning a specific person (`SLACK_MENTION_USER_ID`, e.g. เบนซ์). The API route is session-gated, requires a non-empty `message`, optionally uploads an image `screenshot` via `uploadReceiptFile` into the caller's team Drive folder (`แจ้งบัค` subfolder) and includes its link in the Slack message. Throws a clear typed error (`SlackNotConfiguredError`) if the webhook isn't configured yet, surfaced verbatim to the UI instead of a generic failure. `components/ReportBugButton.tsx` is the floating button + modal (mirrors `design/ReportBug.dc.html`) — self-contained and session-gated (`useSession()`), ready to mount into the layout.
- **API routes**: `GET/POST /api/expenses`, `POST /api/expenses/[id]/status`, `GET /api/expenses/petty-cash-status`, `POST /api/upload`, `POST /api/ocr`, `POST /api/receipt-doc`, `POST /api/report-bug`.
- **Pages**: `/login`, `/` (expense form with camera/file-attach OCR prefill — all fields remain directly editable for review/correction; auto-classifies fund type and pre-submit duplicate-checks, see above), `/review` (list รอตรวจ rows, mark ตรวจแล้ว/ต้องแก้ไข), `/receipt-doc/create` (generates and downloads the .docx, with a live Thai-baht-text preview, optional link to a รอตรวจ row, and auto-upload to Drive).

## What's stubbed / deferred (follow-up work)

- **Dashboard, Approver pages** — not built in this pass (see `design/*.dc.html` for their mockups); only Login, Main, Review, CreateReceiptDoc, and the ReportBug button were built.
- **Real Odoo category list** — `หมวดหมู่ (ตาม Odoo)` is a free-text input; blocked on [`docs/04-open-items.md`](../docs/04-open-items.md) item A ("หมวดหมู่ + Cost Center + Acc name จริงจาก Odoo"). `Cost Center` / `Acc name` columns exist in the schema but have no form fields yet for the same reason.
- **Refresh-token rotation** — `lib/auth.ts` stores the Google `refresh_token` on the JWT but does not yet use it to silently renew an expired `access_token` (~1 hour lifetime); users will need to re-sign-in after it expires.
- **Sequential "รหัสรายการ" numbering** — `generateExpenseId()` produces a timestamp-based unique id (`EX-...`), not the sequential `EX-2026-0001`-style id shown in the sheet template's example row; real sequential numbering needs to read the sheet's current max id first.
- **TDFB logo** — still the `[TDFB LOGO]` placeholder in the generated document, per the known limitation noted in `templates/receipt-doc/README.md`.
- **OCR accuracy is photo-dependent** — extraction quality depends on photo quality/lighting; handwritten Thai receipts or heavily faded thermal-paper receipts will often need manual correction after prefill. This is expected behavior, not a bug to chase — it's why every OCR-filled field stays editable rather than locked.
