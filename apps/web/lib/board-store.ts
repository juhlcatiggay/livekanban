import { create } from "zustand";
import PartySocket from "partysocket";
import { nanoid } from "nanoid";
import {
  CloseCode,
  PARTY,
  applyOp,
  encode,
  parseOp,
  type BoardData,
  type ClientMessage,
  type CommittedOp,
  type Identity,
  type Op,
  type Peer,
  type PresencePatch,
  type ServerMessage,
} from "@livekanban/protocol";
import { PARTY_HOST } from "./config";
import { clearCursors, dropCursor, pushCursor } from "./cursors";
import { saveIdentity } from "./identity";
import { forgetBoard, rememberBoard } from "./recent-boards";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "expired" | "full";

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

  /** Applies `op` optimistically and sends it to the room. */
  dispatch: (op: Op) => void;
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
  dispatch: noop,
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
export function connectBoard(boardId: string, initialIdentity: Identity): () => void {
  const set = useBoard.setState;
  let identity = initialIdentity;

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
    const meta = { at: Date.now(), by: identity.name };
    set({ board: pending.reduce((b, p) => applyOp(b, p.op, meta), confirmed) });
  };

  const applyCommitted = (c: CommittedOp) => {
    if (!confirmed || c.seq <= seq) return;
    confirmed = applyOp(confirmed, c.op, c);
    seq = c.seq;
  };

  const sendOp = (p: PendingOp) => send({ t: "op", cid: p.cid, op: p.wire });

  const dispatch = (op: Op) => {
    // Normalize exactly as the room will (trimming, deduped labels) so the optimistic view matches.
    const wire = parseOp(op);
    if (!wire) {
      set({ error: "That change isn't valid." });
      return;
    }
    // Restores carry the deleted item locally so it reappears before the room confirms.
    const p: PendingOp = { cid: nanoid(12), op: { ...op, ...wire } as Op, wire, resent: false };
    pending.push(p);
    recompute();
    sendOp(p);
    if (wire.kind === "board.update") rememberBoard(boardId, wire.title);
  };

  const setPresence = (patch: PresencePatch) => {
    presence = { ...presence, ...patch };
    send({ t: "presence", patch });
  };

  const setProfile = (name: string, color: string) => {
    identity = { ...identity, name, color };
    saveIdentity(identity);
    set({ me: identity });
    send({ t: "profile", name, color });
  };

  set(
    {
      ...initialState,
      me: identity,
      dispatch,
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

  socket.addEventListener("open", () => {
    socket.send(encode({ t: "hello", ...identity, lastSeq: confirmed ? seq : 0 }));
  });

  socket.addEventListener("message", (event: MessageEvent<string>) => {
    const msg = JSON.parse(event.data) as ServerMessage;
    if (Array.isArray(msg)) {
      const [, connectionId, anchor, fx, fy] = msg;
      pushCursor(connectionId, anchor, fx, fy);
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
          selfPeer: null,
          keptUntil: msg.keptUntil,
          peers: Object.fromEntries(msg.peers.map((p) => [p.connectionId, p])),
        });
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
        if (msg.peer.connectionId === useBoard.getState().self) set({ selfPeer: msg.peer });
        else set((s) => ({ peers: { ...s.peers, [msg.peer.connectionId]: msg.peer } }));
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
      case "lockDenied":
        set({ lockDenied: msg.cardId, error: `${msg.by} is moving this card` });
        break;
      case "expired":
        forgetBoard(boardId);
        stop("expired");
        break;
    }
  });

  socket.addEventListener("close", (event: CloseEvent) => {
    synced = false;
    clearCursors();
    pending = pending.map((p) => ({ ...p, resent: true }));
    if (event.code === CloseCode.Expired) return stop("expired");
    if (event.code === CloseCode.RoomFull) return stop("full");
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
    set({ dispatch: noop, sendCursor: noop, setPresence: noop, setProfile: noop, lockCard: noop, unlockCard: noop });
  };
}

/** Client-generated id for a new column or card. */
export const newItemId = () => nanoid(10);
