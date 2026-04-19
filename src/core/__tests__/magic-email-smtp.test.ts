/**
 * SMTP helpers for magic_email — mock transport only (no real network).
 */

import { describe, expect, it, vi } from "vitest";
import type { Transporter } from "nodemailer";
import {
  createSmtpTransport,
  createSmtpTransportFromEnv,
  readSmtpEnv,
  sendMagicEmail,
} from "../magic-email-smtp";

describe("readSmtpEnv", () => {
  it("returns null when SMTP_HOST is empty", () => {
    vi.stubEnv("SMTP_HOST", "");
    try {
      expect(readSmtpEnv()).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("parses host, port, secure defaults, auth, from", () => {
    vi.stubEnv("SMTP_HOST", "smtp.mail.test");
    vi.stubEnv("SMTP_PORT", "587");
    vi.stubEnv("SMTP_SECURE", "false");
    vi.stubEnv("SMTP_USER", "user");
    vi.stubEnv("SMTP_PASS", "secret");
    vi.stubEnv("SMTP_FROM", "KrwnOS <noreply@mail.test>");
    try {
      expect(readSmtpEnv()).toEqual({
        host: "smtp.mail.test",
        port: 587,
        secure: false,
        user: "user",
        pass: "secret",
        from: "KrwnOS <noreply@mail.test>",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("defaults secure to true for port 465 when SMTP_SECURE is omitted", () => {
    vi.stubEnv("SMTP_HOST", "smtp.mail.test");
    vi.stubEnv("SMTP_PORT", "465");
    try {
      const cfg = readSmtpEnv();
      expect(cfg?.secure).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("throws on invalid SMTP_PORT", () => {
    vi.stubEnv("SMTP_HOST", "h");
    vi.stubEnv("SMTP_PORT", "99999");
    try {
      expect(() => readSmtpEnv()).toThrow(/Invalid SMTP_PORT/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("createSmtpTransport", () => {
  it("builds a transport that can be replaced by mocks in tests", () => {
    const cfg = {
      host: "localhost",
      port: 1025,
      secure: false,
    };
    const t = createSmtpTransport(cfg);
    expect(t).toBeDefined();
    expect(typeof t.sendMail).toBe("function");
  });
});

describe("createSmtpTransportFromEnv", () => {
  it("throws when SMTP is not configured", () => {
    vi.stubEnv("SMTP_HOST", "");
    try {
      expect(() => createSmtpTransportFromEnv()).toThrow(/SMTP_HOST/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("sendMagicEmail", () => {
  it("delegates to transport.sendMail with resolved From", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "<test@id>" });
    const transport = { sendMail } as unknown as Transporter;

    await sendMagicEmail(
      transport,
      {
        to: "citizen@state.test",
        subject: "Your magic link",
        text: "Open https://example/invite/token",
        html: "<p>Open link</p>",
      },
      { defaultFrom: "KrwnOS <noreply@state.test>" },
    );

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith({
      from: "KrwnOS <noreply@state.test>",
      to: "citizen@state.test",
      subject: "Your magic link",
      text: "Open https://example/invite/token",
      html: "<p>Open link</p>",
    });
  });

  it("uses message.from over defaultFrom", async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    const transport = { sendMail } as unknown as Transporter;

    await sendMagicEmail(
      transport,
      {
        from: "Other <other@x.test>",
        to: "a@b.c",
        subject: "s",
        text: "t",
      },
      { defaultFrom: "Default <d@d.c>" },
    );

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Other <other@x.test>" }),
    );
  });

  it("throws when no From can be resolved", async () => {
    const transport = {
      sendMail: vi.fn(),
    } as unknown as Transporter;

    await expect(
      sendMagicEmail(transport, {
        to: "a@b.c",
        subject: "s",
        text: "t",
      }),
    ).rejects.toThrow(/set `from`/);
    expect(transport.sendMail).not.toHaveBeenCalled();
  });
});
