"use client";

import type { BoardData } from "@livekanban/protocol";
import { useBoard } from "@/lib/board-store";
import { useCan } from "@/lib/use-can";
import { useUndo } from "@/lib/undo";
import { CardDialog } from "./card-dialog";

/** The card dialog with its (undoable) delete action, for any view that opens cards. */
export function CardDialogFor({ board, cardId, onClose }: { board: BoardData; cardId: string; onClose: () => void }) {
  const dispatch = useBoard((s) => s.dispatch);
  const offerUndo = useUndo((s) => s.offer);
  const can = useCan();
  const card = board.cards[cardId];
  if (!card) return null;

  return (
    <CardDialog
      key={card.id}
      card={card}
      columnTitle={board.columns[card.columnId]?.title ?? ""}
      onClose={onClose}
      readOnly={!can.editCards}
      onDelete={(c) => {
        onClose();
        dispatch({ kind: "card.delete", id: c.id });
        offerUndo(`Card “${c.title}” deleted`, { kind: "card.restore", id: c.id, card: c });
      }}
    />
  );
}
