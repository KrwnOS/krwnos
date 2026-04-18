/**
 * Tiny, dependency-free Markdown renderer tuned for chat.
 * ------------------------------------------------------------
 * We deliberately keep this under ~150 LoC instead of pulling
 * `react-markdown` + `remark-gfm` (≈100 KB gzipped with a dozen
 * transitive deps) — chat messages almost never need the full CommonMark
 * surface, and rolling our own gives us full XSS control: we never
 * assemble any raw HTML string, every rendered element is a React node.
 *
 * Supported subset (enough to feel like "proper" Markdown):
 *   * Paragraphs & soft line breaks.
 *   * **bold**, *italic*, `inline code`.
 *   * ```fenced code blocks``` (no language highlighting).
 *   * `-` / `*` bullet lists, `1.` ordered lists.
 *   * `> quote` block quotes.
 *   * Autolinks: [text](https://…)  (only http/https allowed).
 *
 * Unsupported on purpose: raw HTML (stripped), tables, images, inline
 * HTML escapes. Anything unrecognised falls through as plain text.
 */

"use client";

import React from "react";

export function MarkdownText({ children }: { children: string }) {
  return <div className="space-y-2 text-sm leading-relaxed">{renderBlocks(children)}</div>;
}

// ------------------------------------------------------------
// Block-level parsing
// ------------------------------------------------------------

function renderBlocks(src: string): React.ReactNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Fenced code block
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i] ?? "")) {
        buf.push(lines[i] ?? "");
        i += 1;
      }
      i += 1; // skip closing ```
      out.push(
        <pre
          key={k++}
          className="overflow-x-auto rounded-md border border-border/60 bg-muted/60 p-3 font-mono text-xs"
        >
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? "")) {
        buf.push((lines[i] ?? "").replace(/^>\s?/, ""));
        i += 1;
      }
      out.push(
        <blockquote
          key={k++}
          className="border-l-2 border-crown/60 pl-3 italic text-foreground/80"
        >
          {renderInline(buf.join(" "))}
        </blockquote>,
      );
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^[-*]\s+/, ""));
        i += 1;
      }
      out.push(
        <ul key={k++} className="list-disc space-y-1 pl-5">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      out.push(
        <ol key={k++} className="list-decimal space-y-1 pl-5">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Paragraph: collect consecutive non-blank, non-special lines.
    const paragraph: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (
        l.trim() === "" ||
        /^```/.test(l) ||
        /^>\s?/.test(l) ||
        /^[-*]\s+/.test(l) ||
        /^\d+\.\s+/.test(l)
      ) {
        break;
      }
      paragraph.push(l);
      i += 1;
    }
    out.push(
      <p key={k++} className="whitespace-pre-wrap">
        {renderInline(paragraph.join("\n"))}
      </p>,
    );
  }
  return out;
}

// ------------------------------------------------------------
// Inline parsing: bold / italic / code / links.
// Emits React nodes directly to avoid constructing raw HTML strings.
// ------------------------------------------------------------

const INLINE_PATTERNS: Array<{
  re: RegExp;
  render: (m: RegExpExecArray, key: number) => React.ReactNode;
}> = [
  {
    // Inline code first so **…** or [..] inside code are ignored.
    re: /`([^`]+)`/g,
    render: (m, key) => (
      <code
        key={key}
        className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
      >
        {m[1]}
      </code>
    ),
  },
  {
    re: /\*\*([^*]+)\*\*/g,
    render: (m, key) => (
      <strong key={key} className="font-semibold">
        {m[1]}
      </strong>
    ),
  },
  {
    re: /(^|[^*])\*([^*\n]+)\*/g,
    render: (m, key) => (
      <React.Fragment key={key}>
        {m[1]}
        <em className="italic">{m[2]}</em>
      </React.Fragment>
    ),
  },
  {
    re: /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    render: (m, key) => (
      <a
        key={key}
        href={m[2]}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="text-crown underline underline-offset-2 hover:text-crown-soft"
      >
        {m[1]}
      </a>
    ),
  },
];

function renderInline(text: string): React.ReactNode[] {
  // Sequentially apply each pattern, splitting the text into chunks.
  // Chunks are either plain strings or already-rendered React nodes.
  let chunks: Array<string | React.ReactNode> = [text];
  let keyBase = 0;

  for (const { re, render } of INLINE_PATTERNS) {
    const next: Array<string | React.ReactNode> = [];
    for (const chunk of chunks) {
      if (typeof chunk !== "string") {
        next.push(chunk);
        continue;
      }
      let lastIndex = 0;
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(chunk))) {
        if (match.index > lastIndex) {
          next.push(chunk.slice(lastIndex, match.index));
        }
        next.push(render(match, keyBase++));
        lastIndex = match.index + match[0].length;
        if (re.lastIndex === match.index) re.lastIndex += 1; // guard against zero-width
      }
      if (lastIndex < chunk.length) next.push(chunk.slice(lastIndex));
    }
    chunks = next;
  }

  return chunks.map((c, idx) =>
    typeof c === "string" ? <React.Fragment key={idx}>{c}</React.Fragment> : c,
  );
}
