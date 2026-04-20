/**
 * Plain text + minimal HTML bodies for BullMQ email digest jobs.
 */

import type { DigestAggregates } from "./email-digest-aggregate";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderDigestSubject(
  kind: DigestAggregates["kind"],
  stateNameHint: string | null,
): string {
  const scope = stateNameHint ? ` — ${stateNameHint}` : "";
  return kind === "daily"
    ? `KrwnOS — daily digest${scope}`
    : `KrwnOS — weekly digest${scope}`;
}

export function renderDigestEmail(opts: {
  aggregates: DigestAggregates;
  baseUrl: string;
  /** First state slug for deep link when available. */
  stateSlug: string | null;
}): { text: string; html: string } {
  const { aggregates, baseUrl, stateSlug } = opts;
  const dash =
    stateSlug != null
      ? `${baseUrl.replace(/\/$/, "")}/dashboard?state=${encodeURIComponent(stateSlug)}`
      : `${baseUrl.replace(/\/$/, "")}/dashboard`;

  const windowLabel = `${aggregates.window.start.toISOString().slice(0, 10)} … ${aggregates.window.end.toISOString().slice(0, 10)} UTC`;

  const pulseLines =
    aggregates.pulse.length === 0
      ? "— No Pulse highlights in this window.\n"
      : aggregates.pulse
          .map(
            (p) =>
              `* [${p.category}] ${p.titleKey} (${p.createdAt.toISOString()})`,
          )
          .join("\n") + "\n";

  const propLines =
    aggregates.proposals.length === 0
      ? "— No open proposals.\n"
      : aggregates.proposals
          .map(
            (p) =>
              `* ${p.title} (closes ${p.expiresAt.toISOString()})`,
          )
          .join("\n") + "\n";

  const mentionLine =
    aggregates.mentionCount > 0
      ? `\nChat @-mentions (substring): ${aggregates.mentionCount} message(s).\n`
      : "";

  const text = [
    `KrwnOS ${aggregates.kind} digest`,
    `Window: ${windowLabel}`,
    "",
    "Pulse:",
    pulseLines,
    "Open proposals:",
    propLines.trimEnd(),
    mentionLine,
    "",
    `Open dashboard: ${dash}`,
    "",
    "Titles are i18n keys (titleKey) as stored in Pulse — rendered in-app.",
  ].join("\n");

  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">
<h2>${esc(renderDigestSubject(aggregates.kind, null))}</h2>
<p><small>${esc(windowLabel)}</small></p>
<h3>Pulse</h3>
<ul>${aggregates.pulse.map((p) => `<li><strong>${esc(p.category)}</strong> — <code>${esc(p.titleKey)}</code><br/><small>${esc(p.createdAt.toISOString())}</small></li>`).join("") || "<li>—</li>"}</ul>
<h3>Open proposals</h3>
<ul>${aggregates.proposals.map((p) => `<li>${esc(p.title)} <small>(closes ${esc(p.expiresAt.toISOString())})</small></li>`).join("") || "<li>—</li>"}</ul>
${aggregates.mentionCount > 0 ? `<p>Chat @-mentions (substring): <strong>${aggregates.mentionCount}</strong> message(s).</p>` : ""}
<p><a href="${esc(dash)}">Open dashboard</a></p>
</body></html>`;

  return { text, html };
}
