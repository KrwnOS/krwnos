/**
 * SMTP transport for the `magic_email` credential flow.
 * All connection parameters come from environment variables — never
 * hardcode host, passwords, or API keys here.
 *
 * Expected env (when using {@link createSmtpTransportFromEnv}):
 *   * `SMTP_HOST` — required to enable SMTP; if unset, {@link readSmtpEnv} returns null.
 *   * `SMTP_PORT` — optional, default `587`.
 *   * `SMTP_SECURE` — optional; `true` forces TLS (typical for port 465). If omitted, secure is `true` when port is `465`, else `false`.
 *   * `SMTP_USER` / `SMTP_PASS` — optional auth (omit both for servers that allow unauthenticated relay in dev).
 *   * `SMTP_FROM` — default `From` for {@link sendMagicEmail} when the message does not set `from`.
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

export interface SmtpEnvConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  /** Default From when the message omits `from`. */
  from?: string;
}

export interface MagicEmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Overrides `SMTP_FROM` / `defaultFrom` on the send call. */
  from?: string;
}

function parseBoolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  const v = value.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return fallback;
}

/**
 * Reads SMTP settings from `process.env`. Returns `null` if `SMTP_HOST` is unset
 * (feature treated as disabled).
 */
export function readSmtpEnv(): SmtpEnvConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;

  const portRaw = process.env.SMTP_PORT?.trim();
  const port = portRaw ? Number.parseInt(portRaw, 10) : 587;
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid SMTP_PORT: ${portRaw ?? "(empty)"}`);
  }

  const secureDefault = port === 465;
  const secure = parseBoolEnv(process.env.SMTP_SECURE, secureDefault);

  const user = process.env.SMTP_USER?.trim() || undefined;
  const pass = process.env.SMTP_PASS?.length ? process.env.SMTP_PASS : undefined;
  const from = process.env.SMTP_FROM?.trim() || undefined;

  return { host, port, secure, user, pass, from };
}

/**
 * Builds a nodemailer transport from an explicit config (tests or programmatic use).
 */
export function createSmtpTransport(cfg: SmtpEnvConfig): Transporter {
  const auth =
    cfg.user !== undefined && cfg.pass !== undefined
      ? { user: cfg.user, pass: cfg.pass }
      : undefined;

  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth,
  });
}

/**
 * Creates a transport from current env. Throws if `SMTP_HOST` is not set.
 */
export function createSmtpTransportFromEnv(): Transporter {
  const cfg = readSmtpEnv();
  if (!cfg) {
    throw new Error("SMTP_HOST is not set; cannot create SMTP transport.");
  }
  return createSmtpTransport(cfg);
}

export interface SendMagicEmailContext {
  /** Used when `message.from` is omitted (usually mirrors `SMTP_FROM`). */
  defaultFrom?: string;
}

/**
 * Sends one message through the given transport (real SMTP or a mock in tests).
 */
export async function sendMagicEmail(
  transport: Transporter,
  message: MagicEmailMessage,
  context?: SendMagicEmailContext,
): Promise<void> {
  const from = message.from ?? context?.defaultFrom;
  if (!from) {
    throw new Error(
      "Magic email: set `from` on the message, `defaultFrom` in context, or SMTP_FROM in the environment.",
    );
  }

  await transport.sendMail({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
