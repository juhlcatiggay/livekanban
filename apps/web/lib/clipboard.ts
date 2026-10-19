import { useBoard } from "./board-store";

/** Copies text, or explains how to copy by hand when the browser refuses (e.g. not https, or permission denied). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    useBoard.setState({ error: "Couldn't copy. Copy the address from the address bar instead." });
    return false;
  }
}
