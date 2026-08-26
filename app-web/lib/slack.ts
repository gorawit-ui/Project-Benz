/**
 * Slack notification for the "แจ้งปัญหา / บัค" (report-a-bug) feature.
 *
 * Posts a plain `{ text: "..." }` message to a Slack Incoming Webhook — no
 * Slack SDK/app needed, just a webhook URL configured in the Slack workspace
 * (see .env.example / README.md for setup steps). Optionally @-mentions a
 * specific person (SLACK_MENTION_USER_ID) so they see it immediately.
 */

/** Thrown when SLACK_WEBHOOK_URL isn't configured, so callers can surface a clear message instead of pretending the notification went out. */
export class SlackNotConfiguredError extends Error {
  constructor() {
    super("ยังไม่ได้ตั้งค่า SLACK_WEBHOOK_URL — แจ้งปัญหาไปที่ Slack ไม่ได้");
    this.name = "SlackNotConfiguredError";
  }
}

export interface NotifyBugInput {
  message: string;
  reporterName: string;
  reporterEmail: string;
  screenshotLink?: string;
}

/**
 * POSTs a formatted bug report to the configured Slack Incoming Webhook.
 * Throws SlackNotConfiguredError if SLACK_WEBHOOK_URL is unset, and a plain
 * Error if Slack itself rejects the request — both are meant to be caught by
 * the calling API route and turned into a helpful error response.
 */
export async function notifyBug(input: NotifyBugInput): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new SlackNotConfiguredError();
  }

  const mentionUserId = process.env.SLACK_MENTION_USER_ID;
  const lines = [
    ":warning: *แจ้งปัญหา Expense Tracking*",
    `${mentionUserId ? `<@${mentionUserId}> ` : ""}ผู้แจ้ง: ${input.reporterName} (${input.reporterEmail})`,
    input.message,
  ];
  if (input.screenshotLink) {
    lines.push(`<${input.screenshotLink}|ดูภาพหน้าจอที่แนบมา>`);
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: lines.join("\n"), mrkdwn: true }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack webhook responded with ${res.status}${body ? `: ${body}` : ""}`);
  }
}
