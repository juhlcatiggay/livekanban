import { create } from "zustand";
import { checklistProgress, labelKey, type Card } from "@livekanban/protocol";

export type DueFilter = "any" | "overdue" | "week" | "none";

/** What the search bar shows; local to this tab, shared by the kanban and the calendar. */
export interface CardFilter {
  query: string;
  /** Label keys (lower case); a card matches if it has any of them. */
  labels: string[];
  /** A card matches if any of these people is assigned. */
  assignees: string[];
  due: DueFilter;
}

export const NO_FILTER: CardFilter = { query: "", labels: [], assignees: [], due: "any" };

export const useCardFilter = create<CardFilter>(() => NO_FILTER);

export const setCardFilter = (patch: Partial<CardFilter>) => useCardFilter.setState(patch);
export const clearCardFilter = () => useCardFilter.setState(NO_FILTER);

export const isFiltering = (f: CardFilter) => f.query.trim() !== "" || f.labels.length > 0 || f.assignees.length > 0 || f.due !== "any";

/** Local calendar date as YYYY-MM-DD, `days` from today. */
function isoDay(days = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Whether `card` passes the filter. Every word of the query must appear in
 * the card's title, description, labels, assignees or checklist, or be its
 * number ("12" or "#12").
 */
export function matchesFilter(card: Card, f: CardFilter): boolean {
  if (f.labels.length && !card.labels.some((l) => f.labels.includes(labelKey(l)))) return false;
  if (f.assignees.length && !card.assignees.some((a) => f.assignees.includes(a))) return false;
  if (f.due !== "any") {
    const today = isoDay();
    if (f.due === "none" && card.dueDate) return false;
    if (f.due === "overdue") {
      const { done, total } = checklistProgress(card);
      if (!card.dueDate || card.dueDate >= today || (total > 0 && done === total)) return false;
    }
    if (f.due === "week" && (!card.dueDate || card.dueDate < today || card.dueDate > isoDay(7))) return false;
  }
  const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [card.title, card.description, ...card.labels, ...card.assignees, ...card.checklist.map((i) => i.text)].join("\n").toLowerCase();
  return words.every((w) => haystack.includes(w) || w.replace(/^#/, "") === String(card.number));
}
