import { create } from "zustand";

/**
 * Cards this tab has selected on the kanban (box selection or Ctrl/Shift+click).
 * Local only: others don't see your selection.
 */
interface SelectionState {
  ids: ReadonlySet<string>;
}

const EMPTY: ReadonlySet<string> = new Set();

export const useSelection = create<SelectionState>(() => ({ ids: EMPTY }));

export const selectCards = (ids: Iterable<string>) => useSelection.setState({ ids: new Set(ids) });
export const clearSelection = () => useSelection.getState().ids.size && useSelection.setState({ ids: EMPTY });
export function toggleSelected(id: string) {
  const next = new Set(useSelection.getState().ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  useSelection.setState({ ids: next });
}
