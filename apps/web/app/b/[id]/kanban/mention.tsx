"use client";

import { findByNumber } from "@livekanban/protocol";
import { useBoard } from "@/lib/board-store";
import { jumpTo } from "@/lib/jump";

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
      href={`#${number}`}
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
