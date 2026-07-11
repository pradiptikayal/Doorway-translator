import { WebSocket } from "ws";
import { GoogleGenAI } from "@google/genai";
import { rooms } from "./rooms";
import { createTranslationSession } from "./gemini";
import { getClarificationMessage } from "./config";

export async function handleMessage(clientWs: WebSocket, messageBuffer: any) {
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

    console.log(`[Join Room] Client connected to Room: "${roomId}" (Passcode: ${room.passkey}). Assigned Role: ${role}, Language Selected: "${myLanguage}"`);

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

    const now = Date.now();
    const isNewTurn = !sender.lastAudioTime || (now - sender.lastAudioTime > 2000);
    sender.lastAudioTime = now;

    const session = sender.role === "A" ? room.sessions.aToB : room.sessions.bToA;

    if (isNewTurn) {
      sender.sentScoresForCurrentTurn = false;
    }

    if (!sender.sentScoresForCurrentTurn) {
      // Find the other participant (the listener)
      const listener = Array.from(room.participants.values()).find((p) => p.role !== sender.role);
      if (listener && listener.lastScores) {
        const scores = listener.lastScores;
        const signalText = `[Listener Face State: frown=${scores.frown.toFixed(2)}, hesitation=${scores.hesitation.toFixed(2)}]`;
        console.log(`Sending face signal to room ${roomId} session: ${signalText}`);
        session?.sendRealtimeInput({ text: signalText });
        sender.sentScoresForCurrentTurn = true;
      }
    }

    session?.sendRealtimeInput({ audio: { data: msg.data, mimeType: "audio/pcm;rate=16000" } });
    return;
  }

  if (msg.type === "interrupt") {
    const roomId = String(msg.roomId || "default-room");
    const room = rooms.get(roomId);
    if (!room) return;

    Array.from(room.participants.values()).forEach((participant) => {
      participant.ws.send(JSON.stringify({ type: "interrupt" }));
    });
    return;
  }

  if (msg.type === "clarification_request") {
    const roomId = String(msg.roomId || "default-room");
    const room = rooms.get(roomId);
    if (!room) return;

    const sender = Array.from(room.participants.values()).find((participant) => participant.ws === clientWs);
    if (!sender) return;

    const userLang = sender.role === "A" ? room.languageA : room.languageB;
    clientWs.send(
      JSON.stringify({
        type: "clarification",
        message: getClarificationMessage(userLang, "lowConfidence"),
      }),
    );
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

  if (msg.type === "face_expression") {
    const roomId = String(msg.roomId || "default-room");
    const room = rooms.get(roomId);
    if (!room) return;
    const sender = Array.from(room.participants.values()).find((participant) => participant.ws === clientWs);
    if (!sender) return;

    sender.lastScores = msg.scores;

    // Find the active speaker (the other participant)
    const speaker = Array.from(room.participants.values()).find((p) => p.role !== sender.role);
    if (speaker && msg.scores) {
      const { frown, hesitation } = msg.scores;
      if (frown > 0.35 || hesitation > 0.35) {
        const speakerLang = speaker.role === "A" ? room.languageA : room.languageB;
        speaker.ws.send(JSON.stringify({
          type: "clarification",
          message: getClarificationMessage(speakerLang, "confused"),
        }));
      }
    }
    return;
  }

  if (msg.type === "setup") {
    clientWs.send(JSON.stringify({ type: "error", error: "Single-device mode is no longer used in this build. Use join_room instead." }));
    return;
  }
}

export function handleClose(clientWs: WebSocket) {
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
}
