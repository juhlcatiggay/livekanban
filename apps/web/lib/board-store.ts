import { create } from "zustand";
import PartySocket from "partysocket";
import { nanoid } from "nanoid";
import {
  CloseCode,
  PARTY,
  applyOp,
  encode,
  opTarget,
  parseOp,
  type BackupInfo,
  type BoardData,
  type ClientMessage,
  type CommittedOp,
  type Identity,
  type Op,
  type Peer,
  type PresencePatch,
  type ServerMessage,
  type TrashItem,
} from "@livekanban/protocol";
import { PARTY_HOST } from "./config";
import { clearCursors, dropCursor, pushCursor } from "./cursors";
import { HISTORY_LIMIT, coalesces, invert, type HistoryEntry } from "./history";
import { forgetBoardPassword, getBoardPassword, saveBoardPassword } from "./board-passwords";
import { saveIdentity } from "./identity";
import { forgetBoard, rememberBoard } from "./recent-boards";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "expired" | "deleted" | "full" | "password";

/** A page of history as shown in the history panel or a card's Activity list. */
export interface HistoryView {
  /** Only ops about this card or note; board-wide when absent. */
  id?: string;
  /** Newest first. */
  entries: CommittedOp[];
  more: boolean;
  loading: boolean;
}

interface BoardState {
  status: ConnectionStatus;
  me: Identity | null;
  self: string | null;
  /** Everyone else on the board, by connection id. */
  peers: Record<string, Peer>;
  /** This tab as the room sees it (holding, editing, idle). */
  selfPeer: Peer | null;
  keptUntil: number | null;
  rtt: number | null;
  /** What the UI shows: the room's confirmed state with this tab's pending ops applied. */
  board: BoardData | null;
  /** Latest reason the room rejected one of this tab's changes. */
  error: string | null;
  /** Card this tab tried to pick up while someone else held it. */
  lockDenied: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Latest trash listing, after requestTrash(). */
  trash: { items: TrashItem[]; backups: BackupInfo[] } | null;
  /** The board has a password (everyone but the host needs it to open the board). */
  locked: boolean;
  /** While status is "password": whether the last password was wrong, and when guessing may resume. */
  passwordPrompt: { wrong: boolean; retryAt: number | null } | null;
  /** Board-wide history, once requested; new changes are added live. */
  history: HistoryView | null;
  /** One card's history (its Activity list), once requested. */
  itemHistory: HistoryView | null;

  /**
   * Applies `op` optimistically and sends it to the room. Recorded for
   * undo/redo unless `record` is false.
   */
  dispatch: (op: Op, options?: { record?: boolean; group?: string }) => void;
  /** Applies several ops as one change: a single undo reverts them all. */
  dispatchAll: (ops: Op[]) => void;
  /** Host only: deletes the board for everyone. */
  deleteBoard: () => void;
  /** Host only: sets or (null) removes the board's password. */
  setPassword: (password: string | null) => void;
  /** Tries a password for a protected board (and remembers it if it works). */
  submitPassword: (password: string) => void;
  /** Loads history: the first page, or (`older`) the next older page. With `id`, one card's or note's. */
  requestHistory: (options?: { id?: string; older?: boolean }) => void;
  /** Stops tracking a history view (board-wide, or `id`'s). */
  closeHistory: (id?: string) => void;
  /** Who deleted the board, once status is "deleted". */
  deletedBy: string | null;
  undo: () => void;
  redo: () => void;
  requestTrash: () => void;
  /** Resolves with a daily backup's board, or null if it no longer exists. */
  fetchBackup: (day: string) => Promise<BoardData | null>;
  /** Sends this tab's cursor; a null anchor hides it. */
  sendCursor: (anchor: string | null, fx: number, fy: number) => void;
  setPresence: (patch: PresencePatch) => void;
  setProfile: (name: string, color: string) => void;
  lockCard: (cardId: string) => void;
  unlockCard: (cardId: string) => void;
  clearError: () => void;
}

const noop = () => {};

const initialState = {
  status: "connecting" as ConnectionStatus,
  me: null,
  self: null,
  peers: {},
  selfPeer: null,
  keptUntil: null,
  rtt: null,
  board: null,
  error: null,
  lockDenied: null,
  canUndo: false,
  canRedo: false,
  trash: null,
  locked: false,
  passwordPrompt: null,
  history: null,
  itemHistory: null,
  dispatch: noop,
  dispatchAll: noop,
  deleteBoard: noop,
  setPassword: noop,
  submitPassword: noop,
  requestHistory: noop,
  closeHistory: noop,
  deletedBy: null,
  undo: noop,
  redo: noop,
  requestTrash: noop,
  fetchBackup: () => Promise.resolve(null),
  sendCursor: noop,
  setPresence: noop,
  setProfile: noop,
  lockCard: noop,
  unlockCard: noop,
};

export const useBoard = create<BoardState>((set) => ({
  ...initialState,
  clearError: () => set({ error: null }),
}));

const PING_INTERVAL_MS = 5000;

interface PendingOp {
  cid: string;
  /** Applied locally. */
  op: Op;
  /** Sent to the room. */
  wire: Op;
  /** Re-sent after a reconnect; it may already be committed, so a reject is expected and silent. */
  resent: boolean;
}

/** Opens the board's socket and feeds the store. Returns a disconnect function. */
/** `hostKey` (if this browser holds one for the board) makes this tab the host. */
export function connectBoard(boardId: string, initialIdentity: Identity, hostKey?: string): () => void {
  const set = useBoard.setState;
  /** This browser's identity, as stored; sent in `hello`. */
  let identity = initialIdentity;
  /** Who this browser is on this board: the room picks the name, so it can differ from `identity`. */
  let me = initialIdentity;
  const setMe = (name: string, color: string) => {
    me = { ...me, name, color };
    set({ me });
  };

  /** Room state as of `seq`; null until the first sync. */
  let confirmed: BoardData | null = null;
  let seq = 0;
  let pending: PendingOp[] = [];
  /** True between `welcome` and the next disconnect: messages can be sent. */
  let synced = false;
  /** This tab's presence, re-sent after a reconnect because the room forgets it. */
  let presence: PresencePatch = {};

  const socket = new PartySocket({ host: PARTY_HOST, party: PARTY, room: boardId });
  const send = (msg: ClientMessage) => {
    if (synced) socket.send(encode(msg));
  };

  const recompute = () => {
    if (!confirmed) return;
    const meta = { at: Date.now(), by: me.name };
    set({ board: pending.reduce((b, p) => applyOp(b, p.op, meta), confirmed) });
  };

  const applyCommitted = (c: CommittedOp) => {
    if (!confirmed || c.seq <= seq) return;
    confirmed = applyOp(confirmed, c.op, c);
    seq = c.seq;
    addToHistory(c);
  };

  /** Open history views show new changes as they're committed. */
  const addToHistory = (c: CommittedOp) => {
    const { history, itemHistory } = useBoard.getState();
    const prepend = (view: HistoryView) => (view.entries.some((e) => e.seq === c.seq) ? view : { ...view, entries: [c, ...view.entries] });
    if (history) set({ history: prepend(history) });
    if (itemHistory && opTarget(c.op) === itemHistory.id) set({ itemHistory: prepend(itemHistory) });
  };

  const requestHistory = ({ id, older = false }: { id?: string; older?: boolean } = {}) => {
    const key = id ? "itemHistory" : "history";
    const current = useBoard.getState()[key];
    const sameView = current && current.id === id;
    if (older && (!sameView || !current.more || current.loading)) return;
    const before = older && sameView ? current.entries.at(-1)?.seq : undefined;
    set({ [key]: { id, entries: older && sameView ? current.entries : [], more: false, loading: true } });
    send({ t: "history", before, id });
  };

  /** The password this tab is trying, or the remembered one. */
  let password = getBoardPassword(boardId);
  const sayHello = () =>
    socket.send(encode({ t: "hello", ...identity, custom: identity.custom ?? false, lastSeq: confirmed ? seq : 0, hostKey, password }));

  const sendOp = (p: PendingOp) => send({ t: "op", cid: p.cid, op: p.wire });

  /** This tab's own changes, newest last. Remote edits aren't undoable from here. */
  let undoStack: HistoryEntry[] = [];
  let redoStack: HistoryEntry[] = [];
  const publishHistory = () => set({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });

  /** Records `op` (about to be applied) with its inverse against the current view. */
  const record = (stack: HistoryEntry[], op: Op, group?: string): HistoryEntry[] => {
    const board = useBoard.getState().board;
    const inverse = board ? invert(board, op) : null;
    if (!inverse) return stack;
    const entry: HistoryEntry = { op, inverse, at: Date.now(), group };
    // Typing into a field produces a save every 300 ms; keep the oldest inverse so one undo restores it.
    if (coalesces(stack.at(-1), entry)) return [...stack.slice(0, -1), { ...entry, inverse: stack.at(-1)!.inverse }];
    return [...stack, entry].slice(-HISTORY_LIMIT);
  };

  const dispatch = (op: Op, { record: recordIt = true, group }: { record?: boolean; group?: string } = {}) => {
    // Normalize exactly as the room will (trimming, deduped labels) so the optimistic view matches.
    const wire = parseOp(op);
    if (!wire) {
      set({ error: "That change isn't valid." });
      return;
    }
    if (recordIt) {
      undoStack = record(undoStack, op, group);
      redoStack = [];
      publishHistory();
    }
    // Restores carry the deleted item locally so it reappears before the room confirms.
    const p: PendingOp = { cid: nanoid(12), op: { ...op, ...wire } as Op, wire, resent: false };
    pending.push(p);
    recompute();
    sendOp(p);
    if (wire.kind === "board.update") rememberBoard(boardId, wire.title);
  };

  const dispatchAll = (ops: Op[]) => {
    const group = ops.length > 1 ? nanoid(8) : undefined;
    for (const op of ops) dispatch(op, { group });
  };

  /** Applies the top entry's inverse and moves it to the other stack, inverted again. */
  const stepOne = (from: "undo" | "redo"): HistoryEntry | undefined => {
    const source = from === "undo" ? undoStack : redoStack;
    const entry = source.at(-1);
    if (!entry) return;
    if (from === "undo") undoStack = undoStack.slice(0, -1);
    else redoStack = redoStack.slice(0, -1);
    const back = record([], entry.inverse, entry.group)[0];
    if (back) {
      if (from === "undo") redoStack = [...redoStack, back];
      else undoStack = [...undoStack, back].slice(-HISTORY_LIMIT);
    }
    dispatch(entry.inverse, { record: false });
    return entry;
  };

  /** Undoes or redoes one step: a single change, or every op of a grouped one (e.g. moving several cards). */
  const step = (from: "undo" | "redo") => {
    const first = stepOne(from);
    while (first?.group && (from === "undo" ? undoStack : redoStack).at(-1)?.group === first.group) stepOne(from);
    publishHistory();
  };

  const backupWaiters = new Map<string, ((board: BoardData | null) => void)[]>();
  const fetchBackup = (day: string) =>
    new Promise<BoardData | null>((resolve) => {
      backupWaiters.set(day, [...(backupWaiters.get(day) ?? []), resolve]);
      send({ t: "backup", day });
    });

  const setPresence = (patch: PresencePatch) => {
    presence = { ...presence, ...patch };
    send({ t: "presence", patch });
  };

  const setProfile = (name: string, color: string) => {
    // A chosen name is kept and asked for on boards this browser hasn't joined yet.
    identity = { ...identity, name, color, custom: true };
    saveIdentity(identity);
    setMe(name, color);
    send({ t: "profile", name, color });
  };

  set(
    {
      ...initialState,
      me,
      dispatch,
      dispatchAll,
      deleteBoard: () => send({ t: "deleteBoard" }),
      setPassword: (next) => {
        send({ t: "setPassword", password: next });
        // The host doesn't need it, but their other devices without the host link would.
        if (next) saveBoardPassword(boardId, next);
        else forgetBoardPassword(boardId);
      },
      submitPassword: (next) => {
        password = next;
        set({ passwordPrompt: { wrong: false, retryAt: null } });
        if (socket.readyState === WebSocket.OPEN) sayHello();
      },
      requestHistory,
      closeHistory: (id) => set(id ? { itemHistory: null } : { history: null }),
      undo: () => step("undo"),
      redo: () => step("redo"),
      requestTrash: () => send({ t: "trash" }),
      fetchBackup,
      setPresence,
      setProfile,
      sendCursor: (anchor, fx, fy) => send(["c", anchor, fx, fy]),
      lockCard: (cardId) => {
        set({ lockDenied: null });
        send({ t: "lock", cardId });
      },
      unlockCard: (cardId) => send({ t: "unlock", cardId }),
    },
    false,
  );

  const stop = (status: ConnectionStatus) => {
    synced = false;
    set({ status, peers: {} });
    clearCursors();
    socket.close();
  };

  socket.addEventListener("open", sayHello);

  socket.addEventListener("message", (event: MessageEvent<string>) => {
    const msg = JSON.parse(event.data) as ServerMessage;
    if (Array.isArray(msg)) {
      const self = useBoard.getState().self;
      for (const [connectionId, anchor, fx, fy] of msg[1]) {
        if (connectionId !== self) pushCursor(connectionId, anchor, fx, fy);
      }
      return;
    }
    switch (msg.t) {
      case "welcome": {
        if (msg.sync.type === "snapshot") {
          confirmed = msg.sync.board;
          seq = msg.sync.seq;
        } else {
          for (const c of msg.sync.ops) applyCommitted(c);
        }
        synced = true;
        set({
          status: "open",
          self: msg.self,
          selfPeer: msg.you,
          keptUntil: msg.keptUntil,
          me: { ...me, name: msg.you.name, color: msg.you.color },
          locked: msg.locked,
          passwordPrompt: null,
          peers: Object.fromEntries(msg.peers.map((p) => [p.connectionId, p])),
        });
        me = { ...me, name: msg.you.name, color: msg.you.color };
        // It worked, so remember it for next time.
        if (password) saveBoardPassword(boardId, password);
        recompute();
        for (const p of pending) sendOp(p);
        if (Object.keys(presence).length) send({ t: "presence", patch: presence });
        if (confirmed) rememberBoard(boardId, confirmed.title);
        break;
      }
      case "join":
        set((s) => ({ peers: { ...s.peers, [msg.peer.connectionId]: msg.peer } }));
        break;
      case "peer":
        if (msg.peer.connectionId === useBoard.getState().self) {
          set({ selfPeer: msg.peer });
          // Another tab of this browser renamed us.
          if (msg.peer.name !== me.name || msg.peer.color !== me.color) setMe(msg.peer.name, msg.peer.color);
        } else set((s) => ({ peers: { ...s.peers, [msg.peer.connectionId]: msg.peer } }));
        break;
      case "leave":
        dropCursor(msg.connectionId);
        set((s) => {
          const peers = { ...s.peers };
          delete peers[msg.connectionId];
          return { peers };
        });
        break;
      case "pong":
        set({ rtt: Math.round(performance.now() - msg.at) });
        break;
      case "ack":
        pending = pending.filter((p) => p.cid !== msg.cid);
        applyCommitted(msg.op);
        recompute();
        break;
      case "reject": {
        const rejected = pending.find((p) => p.cid === msg.cid);
        pending = pending.filter((p) => p.cid !== msg.cid);
        if (rejected && !rejected.resent) set({ error: msg.reason });
        recompute();
        break;
      }
      case "opb":
        applyCommitted(msg.op);
        recompute();
        break;
      case "kept":
        set({ keptUntil: msg.keptUntil });
        break;
      case "trash":
        set({ trash: { items: msg.items, backups: msg.backups } });
        break;
      case "backup":
        for (const resolve of backupWaiters.get(msg.day) ?? []) resolve(msg.board);
        backupWaiters.delete(msg.day);
        break;
      case "profileRejected": {
        const was = useBoard.getState().selfPeer;
        if (was) setMe(was.name, was.color);
        set({ error: msg.reason });
        break;
      }
      case "lockDenied":
        set({ lockDenied: msg.cardId, error: `${msg.by} is moving this card` });
        break;
      case "expired":
        forgetBoard(boardId);
        stop("expired");
        break;
      case "deleted":
        forgetBoard(boardId);
        set({ deletedBy: msg.by });
        stop("deleted");
        break;
      case "passwordRequired":
        if (msg.wrong) {
          forgetBoardPassword(boardId);
          password = undefined;
        }
        set({ status: "password", passwordPrompt: { wrong: msg.wrong, retryAt: msg.retryAfterMs ? Date.now() + msg.retryAfterMs : null } });
        break;
      case "locked":
        set({ locked: msg.locked });
        break;
      case "history": {
        const key = msg.id ? "itemHistory" : "history";
        const current = useBoard.getState()[key];
        // A reply for a view that's been closed or switched to another card.
        if (!current || current.id !== msg.id) break;
        const known = new Set(current.entries.map((e) => e.seq));
        set({ [key]: { id: msg.id, entries: [...current.entries, ...msg.entries.filter((e) => !known.has(e.seq))], more: msg.more, loading: false } });
        break;
      }
      case "refused":
        set({ error: msg.reason });
        break;
    }
  });

  socket.addEventListener("close", (event: CloseEvent) => {
    synced = false;
    clearCursors();
    pending = pending.map((p) => ({ ...p, resent: true }));
    if (useBoard.getState().status === "deleted") return;
    if (event.code === CloseCode.Expired) return stop("expired");
    if (event.code === CloseCode.RoomFull) return stop("full");
    if (event.code === CloseCode.RateLimited) set({ error: "Too many messages from this tab; reconnecting…" });
    const { status } = useBoard.getState();
    if (status === "open" || status === "connecting") set({ status: "reconnecting", peers: {} });
  });

  const ping = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send(encode({ t: "ping", at: performance.now() }));
  }, PING_INTERVAL_MS);

  return () => {
    clearInterval(ping);
    synced = false;
    clearCursors();
    socket.close();
    set({
      dispatch: noop,
      dispatchAll: noop,
      deleteBoard: noop,
      setPassword: noop,
      submitPassword: noop,
      requestHistory: noop,
      undo: noop,
      redo: noop,
      requestTrash: noop,
      sendCursor: noop,
      setPresence: noop,
      setProfile: noop,
      lockCard: noop,
      unlockCard: noop,
    });
  };
}

/** Client-generated id for a new column or card. */
export const newItemId = () => nanoid(10);
