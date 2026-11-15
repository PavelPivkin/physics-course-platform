import { WebSocketServer, WebSocket } from "ws";

const port = Number(process.env.PORT || 8787);
const rooms = new Map();

const server = new WebSocketServer({ port });

function send(socket, payload) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function broadcastRoom(roomId, payload, except) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const client of room.clients) {
    if (client !== except) send(client, payload);
  }
}

function leave(socket) {
  const roomId = socket.roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) return;
  room.clients.delete(socket);
  broadcastRoom(roomId, { type: "peer-left" }, socket);
  if (room.clients.size === 0) rooms.delete(roomId);
}

server.on("connection", (socket) => {
  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(socket, { type: "error", message: "Некорректное сообщение" });
      return;
    }

    if (message.type === "join") {
      const roomId = String(message.room || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
      if (!roomId) {
        send(socket, { type: "error", message: "Не указана комната" });
        return;
      }

      const room = rooms.get(roomId) || { clients: new Set() };
      if (room.clients.size >= 2) {
        send(socket, { type: "error", message: "В комнате уже два участника" });
        return;
      }

      leave(socket);
      socket.roomId = roomId;
      room.clients.add(socket);
      rooms.set(roomId, room);

      const role = room.clients.size === 1 ? "host" : "guest";
      socket.role = role;
      send(socket, { type: "joined", room: roomId, role });

      if (room.clients.size === 2) {
        for (const client of room.clients) send(client, { type: "ready", role: client.role });
      }
      return;
    }

    if (message.type === "signal" && socket.roomId) {
      broadcastRoom(socket.roomId, { type: "signal", data: message.data }, socket);
    }
  });

  socket.on("close", () => leave(socket));
  socket.on("error", () => leave(socket));
});

server.on("listening", () => {
  console.log(`Physics signaling server: ws://0.0.0.0:${port}`);
});

server.on("error", (error) => {
  console.error(`Signaling server error: ${error.message}`);
  process.exitCode = 1;
});
