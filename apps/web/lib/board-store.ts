import { create } from "zustand";
import PartySocket from "partysocket";
import { CloseCode, PARTY, encode, type Identity, type Peer, type ServerMessage } from "@livekanban/protocol";
import { PARTY_HOST } from "./config";
import { forgetBoard, rememberBoard } from "./recent-boards";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "expired" | "full";

interface BoardState {
  status: ConnectionStatus;
  me: Identity | null;
  self: string | null;
  peers: Record<string, Peer>;
  keptUntil: number | null;
  rtt: number | null;
}

const initialState: BoardState = { status: "connecting", me: null, self: null, peers: {}, keptUntil: null, rtt: null };

export const useBoard = create<BoardState>(() => initialState);

const PING_INTERVAL_MS = 5000;

/** Opens the board's socket and feeds the store. Returns a disconnect function. */
export function connectBoard(boardId: string, identity: Identity): () => void {
  useBoard.setState({ ...initialState, me: identity }, true);
  const set = useBoard.setState;

  const socket = new PartySocket({ host: PARTY_HOST, party: PARTY, room: boardId });

  const stop = (status: ConnectionStatus) => {
    set({ status, peers: {} });
    socket.close();
  };

  socket.addEventListener("open", () => {
    socket.send(encode({ t: "hello", ...identity, lastSeq: 0 }));
  });

  socket.addEventListener("message", (event: MessageEvent<string>) => {
    const msg = JSON.parse(event.data) as ServerMessage;
    switch (msg.t) {
      case "welcome":
        set({
          status: "open",
          self: msg.self,
          keptUntil: msg.keptUntil,
          peers: Object.fromEntries(msg.peers.map((p) => [p.connectionId, p])),
        });
        rememberBoard(boardId);
        break;
      case "join":
        set((s) => ({ peers: { ...s.peers, [msg.peer.connectionId]: msg.peer } }));
        break;
      case "leave":
        set((s) => {
          const peers = { ...s.peers };
          delete peers[msg.connectionId];
          return { peers };
        });
        break;
      case "pong":
        set({ rtt: Math.round(performance.now() - msg.at) });
        break;
      case "expired":
        forgetBoard(boardId);
        stop("expired");
        break;
    }
  });

  socket.addEventListener("close", (event: CloseEvent) => {
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
    socket.close();
  };
}
