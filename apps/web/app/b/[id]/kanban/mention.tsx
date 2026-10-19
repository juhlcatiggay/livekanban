"use client";

import type { Root } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";
import { MENTION_RE, findByNumber } from "@livekanban/protocol";
import { useBoard } from "@/lib/board-store";
import { jumpTo } from "@/lib/jump";

/** Fragment used for mention links in the Markdown tree; the link component swaps them for <Mention>. */
export const MENTION_HREF_PREFIX = "#lk-item-";

/** remark plugin: "#12" in text becomes a link to item 12 (never inside code or existing links). */
export function remarkMentions() {
  return (tree: Root) => {
    findAndReplace(
      tree,
      [
        [
          new RegExp(MENTION_RE.source, "g"),
          (value: string, digits: string) => ({
            type: "link",
            url: `${MENTION_HREF_PREFIX}${digits}`,
            children: [{ type: "text", value }],
          }),
        ],
      ],
      { ignore: ["link", "linkReference"] },
    );
  };
}

/**
 * A #12 reference to a card or note on this board. Clicking it glides to the
 * item and shakes it; a card then opens.
 */
export function Mention({ number }: { number: number }) {
  const board = useBoard((s) => s.board);
  const target = board ? findByNumber(board, number) : null;

  if (!target) {
    return (
      <span className="md-mention md-mention-missing" title={`No card or note #${number} on this board`}>
        #{number}
      </span>
    );
  }

  const label = target.kind === "card" ? target.card.title : target.note.text.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "") || "Note";
  const id = target.kind === "card" ? target.card.id : target.note.id;

  return (
    <a
      href={`${MENTION_HREF_PREFIX}${number}`}
      className="md-mention"
      title={`${target.kind === "card" ? "Card" : "Note"} #${number}: ${label}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        jumpTo({ kind: target.kind, id });
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span aria-hidden className="md-mention-icon">
        {target.kind === "card" ? "▤" : "✎"}
      </span>
      <span className="md-mention-number">#{number}</span>
      <span className="md-mention-label">{label.length > 48 ? `${label.slice(0, 47)}…` : label}</span>
    </a>
  );
}
