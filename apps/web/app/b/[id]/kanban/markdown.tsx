"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders a card description. Safe for untrusted text from anyone with the link:
 * - raw HTML is dropped (`skipHtml`), never rendered;
 * - react-markdown's default URL transform strips javascript:, data: and other unsafe schemes;
 * - links open in a new tab with rel="noopener nofollow noreferrer ugc";
 * - images render as their alt text, so a card can't load trackers in viewers' browsers.
 */
const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener nofollow noreferrer ugc">
      {children}
    </a>
  ),
  img: ({ alt }) => <span className="text-stone-500">[image: {alt || "untitled"}]</span>,
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
