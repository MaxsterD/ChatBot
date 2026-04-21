export type WsLike = {
  on: (event: "close", cb: () => void) => void;
  send: (data: string) => void;
  readyState: number;
  OPEN: number;
};

export type RealtimeEvent =
  | { type: "message.new"; conversationId: string }
  | { type: "conversation.updated"; conversationId: string };

export class RealtimeHub {
  private socketsByUserId = new Map<number, Set<WsLike>>();

  add(userId: number, socket: WsLike) {
    const set = this.socketsByUserId.get(userId) ?? new Set<WsLike>();
    set.add(socket);
    this.socketsByUserId.set(userId, set);
    socket.on("close", () => {
      const current = this.socketsByUserId.get(userId);
      if (!current) return;
      current.delete(socket);
      if (current.size === 0) this.socketsByUserId.delete(userId);
    });
  }

  broadcast(event: RealtimeEvent) {
    const msg = JSON.stringify(event);
    for (const set of this.socketsByUserId.values()) {
      for (const ws of set) {
        if (ws.readyState === ws.OPEN) ws.send(msg);
      }
    }
  }
}
