import { create } from "zustand";

export interface ConfirmRequest {
  title: string;
  body?: string;
  /** Label of the destructive button, e.g. "Delete card". */
  confirmLabel: string;
}

interface ConfirmState {
  request: (ConfirmRequest & { resolve: (ok: boolean) => void }) | null;
}

export const useConfirmStore = create<ConfirmState>(() => ({ request: null }));

/**
 * Asks "Are you sure?" in a modal and resolves true only if the person
 * confirms. Rendered by <ConfirmDialog/> on the board page.
 */
export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    // A new question replaces (and declines) any unanswered one.
    useConfirmStore.getState().request?.resolve(false);
    useConfirmStore.setState({ request: { ...request, resolve } });
  });
}

export function answerConfirm(ok: boolean) {
  const { request } = useConfirmStore.getState();
  useConfirmStore.setState({ request: null });
  request?.resolve(ok);
}
