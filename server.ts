import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Modality } from "@google/genai";
import dotenv from "dotenv";

const projectRoot = process.cwd();
dotenv.config({ path: path.resolve(projectRoot, ".env") });
dotenv.config({ path: path.resolve(projectRoot, ".env.local"), override: true });

interface RoomParticipant {
  ws: WebSocket;
  role: "A" | "B";
  id: string;
}

interface RoomState {
  roomId: string;
  passkey: string;
  participants: Map<string, RoomParticipant>;
  languageA: string;
  languageB: string;
  sessions?: {
    aToB: any;
    bToA: any;
  };
}

const rooms = new Map<string, RoomState>();

function buildSystemInstruction(langA: string, langB: string, direction: "A_TO_B" | "B_TO_A") {
  const from = direction === "A_TO_B" ? langA : langB;
  const to = direction === "A_TO_B" ? langB : langA;
  return `You are Doorway, a live translation assistant. Translate naturally from ${from} to ${to}. Use the listener's live video frames as context for confusion. If the listener looks confused, slow down, simplify, and rephrase. Respond only with the translated spoken output.`;
}

async function createTranslationSession(ai: GoogleGenAI, langA: string, langB: string, direction: "A_TO_B" | "B_TO_A", room: RoomState) {
  const targetRole = direction === "A_TO_B" ? "B" : "A";

  return ai.live.connect({
    model: "gemini-3.1-flash-live-preview",
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
      },
      systemInstruction: buildSystemInstruction(langA, langB, direction),
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
    callbacks: {
      onmessage: (message: any) => {
        const parts = message.serverContent?.modelTurn?.parts ?? [];
        const audio = parts.find((part: any) => part.inlineData?.data)?.inlineData?.data;
        const text = parts
          .map((part: any) => part.text)
          .filter(Boolean)
          .join("");

        const targetParticipant = Array.from(room.participants.values()).find((participant) => participant.role === targetRole);

        if (audio && targetParticipant) {
          targetParticipant.ws.send(JSON.stringify({ type: "audio", data: audio }));
        }

        if (text && targetParticipant) {
          targetParticipant.ws.send(JSON.stringify({ type: "transcript", sender: "model", text }));
        }
      },
      onclose: () => {
        console.log(`Session ${direction} closed`);
      },
      onerror: (err: any) => {
        console.error(`Session ${direction} error`, err);
      },
    },
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url || "", `http://${request.headers.host}`).pathname;
    if (pathname === "/live") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (clientWs: WebSocket) => {
    console.log("New WebSocket client connected");

    clientWs.on("message", async (messageBuffer) => {
      try {
        const rawData = messageBuffer.toString();
        const msg = JSON.parse(rawData);

        if (msg.type === "join_room") {
          const apiKey = process.env.GEMINI_API_KEY;
          if (!apiKey) {
            clientWs.send(JSON.stringify({ type: "error", error: "GEMINI_API_KEY environment variable is not set on the server." }));
            return;
          }

          const roomId = String(msg.roomId || "default-room").trim().toLowerCase();
          const action = msg.action || "join";
          const clientPasskey = msg.passkey ? String(msg.passkey).trim() : "";
          const myLanguage = msg.myLanguage || "English";

          let room = rooms.get(roomId);

          if (action === "create") {
            if (room && room.participants.size > 0) {
              clientWs.send(JSON.stringify({ type: "error", error: "A room with this code already exists. Please choose a different code or join it instead." }));
              return;
            }
            const generatedPasskey = Math.floor(100000 + Math.random() * 900000).toString();
            room = {
              roomId,
              passkey: generatedPasskey,
              participants: new Map(),
              languageA: myLanguage,
              languageB: "",
            };
            rooms.set(roomId, room);
          } else {
            // action === "join"
            if (!room) {
              clientWs.send(JSON.stringify({ type: "error", error: "Room not found. Please check the room code or create a new room." }));
              return;
            }
            if (room.passkey !== clientPasskey) {
              clientWs.send(JSON.stringify({ type: "error", error: "Invalid passcode. Please enter the correct passcode for this room." }));
              return;
            }
            if (room.participants.size >= 2) {
              clientWs.send(JSON.stringify({ type: "error", error: "This room is already full." }));
              return;
            }
          }

          // Assign role dynamically based on vacant slots
          let role: "A" | "B" = "A";
          const existingParticipants = Array.from(room.participants.values());
          if (existingParticipants.length > 0) {
            const existingRole = existingParticipants[0].role;
            role = existingRole === "A" ? "B" : "A";
          }

          if (role === "A") {
            room.languageA = myLanguage;
          } else {
            room.languageB = myLanguage;
          }

          const participantId = `${role}-${Date.now()}`;
          room.participants.set(participantId, { ws: clientWs, role, id: participantId });

          const participants = Array.from(room.participants.values());
          if (participants.length === 2) {
            const ai = new GoogleGenAI({
              apiKey,
              httpOptions: { headers: { "User-Agent": "aistudio-build" } },
            });

            if (!room.languageA) room.languageA = "English";
            if (!room.languageB) room.languageB = "Hindi";

            room.sessions = {
              aToB: await createTranslationSession(ai, room.languageA, room.languageB, "A_TO_B", room),
              bToA: await createTranslationSession(ai, room.languageA, room.languageB, "B_TO_A", room),
            };

            participants.forEach((participant) => {
              participant.ws.send(JSON.stringify({
                type: "room_status",
                status: "ready",
                role: participant.role,
                passkey: room!.passkey,
                languageA: room!.languageA,
                languageB: room!.languageB,
              }));
            });
          } else {
            clientWs.send(JSON.stringify({
              type: "room_status",
              status: "waiting",
              role,
              passkey: room.passkey,
              languageA: room.languageA,
              languageB: room.languageB,
            }));
          }

          return;
        }

        if (msg.type === "audio") {
          const roomId = String(msg.roomId || "default-room");
          const room = rooms.get(roomId);
          if (!room || !room.sessions) return;
          const sender = Array.from(room.participants.values()).find((participant) => participant.ws === clientWs);
          if (!sender) return;

          const session = sender.role === "A" ? room.sessions.aToB : room.sessions.bToA;
          session?.sendRealtimeInput({ audio: { data: msg.data, mimeType: "audio/pcm;rate=16000" } });
          return;
        }

        if (msg.type === "video") {
          const roomId = String(msg.roomId || "default-room");
          const room = rooms.get(roomId);
          if (!room || !room.sessions) return;
          const sender = Array.from(room.participants.values()).find((participant) => participant.ws === clientWs);
          if (!sender) return;

          const session = sender.role === "A" ? room.sessions.bToA : room.sessions.aToB;
          session?.sendRealtimeInput({ video: { data: msg.data, mimeType: "image/jpeg" } });
          return;
        }

        if (msg.type === "setup") {
          clientWs.send(JSON.stringify({ type: "error", error: "Single-device mode is no longer used in this build. Use join_room instead." }));
          return;
        }
      } catch (err: any) {
        console.error("Error processing client message:", err);
        clientWs.send(JSON.stringify({ type: "error", error: err.message || String(err) }));
      }
    });

    clientWs.on("close", () => {
      console.log("Client WebSocket closed");
      for (const [roomId, room] of rooms.entries()) {
        const participantEntry = Array.from(room.participants.entries()).find(([, participant]) => participant.ws === clientWs);
        if (!participantEntry) continue;

        const [participantId] = participantEntry;
        room.participants.delete(participantId);

        if (room.sessions) {
          try {
            room.sessions.aToB?.close();
            room.sessions.bToA?.close();
          } catch (e) {
            console.error("Error closing room sessions", e);
          }
        }

        if (room.participants.size === 0) {
          rooms.delete(roomId);
        } else {
          const remainingParticipants = Array.from(room.participants.values());
          remainingParticipants.forEach((participant) => {
            participant.ws.send(JSON.stringify({
              type: "room_status",
              status: "waiting",
              role: participant.role,
              passkey: room.passkey,
              languageA: room.languageA,
              languageB: room.languageB,
            }));
          });
        }
        break;
      }
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT} (http://0.0.0.0:${PORT})`);
  });
}

startServer();
