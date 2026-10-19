"use client";

import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { MENTION_HREF_PREFIX, Mention, remarkMentions } from "./mention";

/**
 * Renders card descriptions and sticky notes: full GitHub-flavored Markdown
 * (headings 1–6, nested and task lists, tables, quotes, code with syntax
 * highlighting, footnotes, strikethrough), with a single Enter as a line break,
 * and #12 mentions of other cards and notes as links to them.
 *
 * Safe for untrusted text from anyone with the link:
 * - raw HTML is dropped (`skipHtml`), never rendered;
 * - react-markdown's default URL transform strips javascript:, data: and other unsafe schemes;
 * - external links open in a new tab with rel="noopener nofollow noreferrer ugc";
 * - images only load when the viewer clicks, so a card can't silently send
 *   everyone's IP address to whatever server hosts its image.
 */
function ClickToLoadImage({ src, alt }: { src?: string; alt?: string }) {
  const [shown, setShown] = useState(false);
  if (typeof src !== "string" || !src) return null;
  let host = "";
  try {
    host = new URL(src).host;
  } catch {
    return null;
  }
  if (shown) {
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary user URLs can't go through next/image.
    return <img src={src} alt={alt ?? ""} referrerPolicy="no-referrer" loading="lazy" />;
  }
  return (
    <span className="md-image-placeholder">
      <span className="md-image-alt">🖼 {alt || "Image"}</span>
      <button type="button" onClick={() => setShown(true)}>
        Load image from {host}
      </button>
    </span>
  );
}

const components: Components = {
  a: ({ href, children }) =>
    href?.startsWith(MENTION_HREF_PREFIX) ? (
      <Mention number={Number(href.slice(MENTION_HREF_PREFIX.length))} />
    ) : href?.startsWith("#") ? (
      // In-document links (footnotes) stay in place.
      <a href={href}>{children}</a>
    ) : (
      <a href={href} target="_blank" rel="noopener nofollow noreferrer ugc">
        {children}
      </a>
    ),
  img: ({ src, alt }) => <ClickToLoadImage src={typeof src === "string" ? src : undefined} alt={alt} />,
  // Wide tables scroll inside their own box instead of stretching the card or note.
  table: ({ children }) => (
    <div className="md-table-wrap">
      <table>{children}</table>
    </div>
  ),
};

const remarkPlugins = [remarkGfm, remarkBreaks, remarkMentions];
const rehypePlugins = [rehypeHighlight];

interface MarkdownProps {
  text: string;
  /** Tighter type scale for sticky notes. */
  compact?: boolean;
  /** Always dark-on-light, for sticky-note paper, whatever the page theme. */
  onPaper?: boolean;
}

export function Markdown({ text, compact = false, onPaper = false }: MarkdownProps) {
  return (
    <div className={`markdown${compact ? " markdown-compact" : ""}${onPaper ? " markdown-paper" : ""}`}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} skipHtml components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
