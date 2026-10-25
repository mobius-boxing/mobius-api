/**
 * The one transactional sender (Resend, over plain HTTPS): module
 * notifications call it directly, and `EmailService`'s account emails
 * (invitations, resets) go through it too.
 *
 * Why not SES: production access for this account was denied, which leaves it
 * sandboxed — able to deliver only to individually verified addresses. The
 * countdown module learned that the expensive way in its previous life: its
 * reminder log was still empty a week after launch because nothing had ever
 * actually reached anyone.
 *
 * No SDK on purpose — sending is one POST and `fetch` is built into Node 20.
 *
 * `RESEND_FROM` must exactly match a domain verified in the Resend account, and
 * it is deliberately a dedicated subdomain: the root mobiusboxing.com records
 * that Mobius and Rol-Pel rely on are never touched, and this sender's
 * reputation is its own.
 *
 * Everything fails soft. A send that cannot be delivered logs and returns false;
 * it never throws, never fails the request or the scheduler run that triggered
 * it, and never logs the message body (bodies can carry links).
 */
const ENDPOINT = "https://api.resend.com/emails";

const DEFAULT_FROM = "Mobius <avisos@avisos.mobiusboxing.com>";

/** A slow network must not wedge the hourly scheduler. */
const TIMEOUT_MS = 10_000;

export interface IModuleEmail {
  to: string;
  subject: string;
  /** Plain text. At least one of `body` and `html` is required. */
  body?: string;
  html?: string;
  /**
   * Optional dedupe key, honoured by Resend for 24 h. The reminder scheduler
   * writes its log row only *after* a send is accepted, so a crash in between
   * would re-send on the next run; this closes that window at the provider.
   */
  idempotencyKey?: string;
}

interface IResendError {
  name?: string;
  message?: string;
}

/**
 * `EMAIL_ALLOWED_RECIPIENTS` (comma list; `@domain` matches a domain, anything
 * else an exact address, case-insensitive) keeps a non-production environment
 * that shares data shapes with customers from mailing them. Unset = no limit.
 */
function isRecipientAllowed(to: string): boolean {
  const entries = (process.env.EMAIL_ALLOWED_RECIPIENTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
  if (entries.length === 0) return true;

  const address = to.trim().toLowerCase();
  return entries.some((entry) =>
    entry.startsWith("@") ? address.endsWith(entry) : address === entry,
  );
}

/** Returns whether the message was actually accepted by the provider. */
export async function sendModuleEmail(email: IModuleEmail): Promise<boolean> {
  // Laptops and CI have no API key by design; don't pretend to send.
  if (process.env.NODE_ENV !== "production") {
    console.info(
      `[module-email] not sent (non-production) to=${email.to} subject="${email.subject}"`,
    );
    return false;
  }

  if (!isRecipientAllowed(email.to)) {
    console.info(
      `[module-email] skipped (not in EMAIL_ALLOWED_RECIPIENTS) to=${email.to} subject="${email.subject}"`,
    );
    return false;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error(
      "[module-email] RESEND_API_KEY is not set — nothing will be delivered",
    );
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(email.idempotencyKey
          ? { "Idempotency-Key": email.idempotencyKey }
          : {}),
      },
      // The body is deliberately never logged.
      body: JSON.stringify({
        from: process.env.RESEND_FROM || DEFAULT_FROM,
        to: email.to,
        subject: email.subject,
        ...(email.body !== undefined ? { text: email.body } : {}),
        ...(email.html !== undefined ? { html: email.html } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Log the provider's reason, never the payload. 429 and 5xx are worth
      // retrying and the caller does exactly that by not recording the send.
      const detail = (await response
        .json()
        .catch(() => null)) as IResendError | null;
      console.error(
        `[module-email] send failed to=${email.to} status=${response.status}` +
          `${detail?.name ? ` name=${detail.name}` : ""}` +
          `${detail?.message ? ` message=${detail.message}` : ""}`,
      );
      return false;
    }

    console.info(
      `[module-email] sent to=${email.to} subject="${email.subject}"`,
    );
    return true;
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `timed out after ${TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : "unknown error";
    console.error(`[module-email] send failed to=${email.to}: ${message}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
