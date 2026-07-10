import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Modality } from "@google/genai";
import dotenv from "dotenv";

//dotenv.config();
const projectRoot = process.cwd();
dotenv.config({ path: path.resolve(projectRoot, ".env") });
dotenv.config({ path: path.resolve(projectRoot, ".env.local"), override: true });

// Helper to build robust translator system instructions
function buildSystemInstruction(langA: string, langB: string): string {
  return `You are "Doorway", a highly professional, polite, and completely transparent ambient real-time translation assistant designed for two people having an in-person conversation in different languages: Language A is "${langA}" and Language B is "${langB}".

You are connected to a continuous bidirectional live audio and video stream of their conversation.

Your absolute highest-priority guidelines are:
1. Continuous Ambient Translation:
- Listen continuously to both speakers. Do not engage in a normal helper assistant chat. Your sole purpose is translation.
- If you hear Language A ("${langA}"), immediately translate it to Language B ("${langB}") and speak the translation in Language B.
- If you hear Language B ("${langB}"), immediately translate it to Language A ("${langA}") and speak the translation in Language A.
- Speak ONLY the translations or the necessary ambient clarifying phrases. Do not say "Here is your translation:" or "Translated text:". Speak the translation directly, as if you are the voice of the speaker.

2. Proactive Clarification:
- If the speaker's audio is muffled, mumbled, too quiet, has overlapping voices (both speaking at once), or uses highly ambiguous/unclear idioms, DO NOT GUESS.
- Instead, politely interrupt the conversation and ask the relevant speaker to repeat themselves, speaking in their own language.
  * E.g., if Language A was mumbled: "Excuse me, I couldn't catch that. Could you please repeat that?" (spoken in "${langA}")
  * E.g., if Language B was mumbled: "Excuse me, I couldn't catch that. Could you please repeat that?" (spoken in "${langB}")

3. Confusion Detection (via Video Stream):
- You receive live video frames of the listeners. Watch their faces closely.
- If the listener looks confused, lost, or displays signs of misunderstanding (such as frowning, knitting their brows, hesitating, or tilting their head in confusion) while the speaker is talking or right after a translation:
  * PROACTIVELY adjust your next translation.
  * Speak slower, with clear diction.
  * Simplify the vocabulary and sentence structure.
  * Offer a brief, helpful clarifying rephrase or short parenthetical explanation to ensure they understand.
  * E.g., instead of a complex word, use simple words, or add: "meaning, they want to..."

4. Idiom Handling:
- When a speaker uses an idiom, metaphor, or phrase that does not translate literally or cleanly, DO NOT force a literal translation.
- Instead, say: "That phrase doesn't translate directly — they said something like '[Literal idea]', which roughly means '[True meaning]'". Speak this explanation in the listener's language.

5. Directness and Modality:
- Keep translations natural, conversational, and direct.
- Speak in a calm, clear, and professional tone.
- Since you are translating in-person conversation, make sure your spoken translation matches the context and conveys the exact emotional tone (polite, excited, concerned) of the original speaker, but with absolute clarity.`;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Simple health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Create standard HTTP server to bind both Express and WebSocket
  const server = http.createServer(app);

  // Set up WebSocket server
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
    let session: any = null;

    clientWs.on("message", async (messageBuffer) => {
      try {
        const rawData = messageBuffer.toString();
        const msg = JSON.parse(rawData);

        if (msg.type === "setup") {
          const { languageA, languageB } = msg;
          console.log(`Setting up Gemini Live session: Language A = ${languageA}, Language B = ${languageB}`);

          // Validate API key exists before initialization
          const apiKey = process.env.GEMINI_API_KEY;
          if (!apiKey) {
            throw new Error("GEMINI_API_KEY environment variable is not set on the server.");
          }

          // Lazy initialization of GoogleGenAI
          const ai = new GoogleGenAI({
            apiKey,
            httpOptions: {
              headers: {
                "User-Agent": "aistudio-build",
              }
            }
          });

          const systemInstructionText = buildSystemInstruction(languageA, languageB);

          // Connect to Gemini Live API
          session = await ai.live.connect({
            model: "gemini-3.1-flash-live-preview",
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
              },
              systemInstruction: systemInstructionText,
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
            callbacks: {
              onmessage: (message: any) => {
                // Forward raw audio chunk (24kHz) to client
                const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (audio) {
                  clientWs.send(JSON.stringify({ type: "audio", data: audio }));
                }

                // Handle interruption (if user spoke while model speaking)
                if (message.serverContent?.interrupted) {
                  clientWs.send(JSON.stringify({ type: "interrupted" }));
                }

                // Forward user input transcription text to client
                if (message.serverContent?.userTurn?.parts) {
                  const text = message.serverContent.userTurn.parts
                    .map((p: any) => p.text)
                    .filter(Boolean)
                    .join("");
                  if (text) {
                    clientWs.send(JSON.stringify({ type: "transcript", sender: "user", text }));
                  }
                }

                // Forward model translation text to client
                if (message.serverContent?.modelTurn?.parts) {
                  const text = message.serverContent.modelTurn.parts
                    .map((p: any) => p.text)
                    .filter(Boolean)
                    .join("");
                  if (text) {
                    clientWs.send(JSON.stringify({ type: "transcript", sender: "model", text }));
                  }
                }
              },
              onclose: () => {
                console.log("Gemini Live session closed internally");
                clientWs.send(JSON.stringify({ type: "status", status: "closed" }));
              },
              onerror: (err: any) => {
                console.error("Gemini Live session error:", err);
                clientWs.send(JSON.stringify({ type: "error", error: err.message || String(err) }));
              }
            }
          });

          clientWs.send(JSON.stringify({ type: "status", status: "connected" }));

        } else if (msg.type === "audio") {
          if (session) {
            // Forward PCM audio chunk (16kHz) to Gemini Live session
            session.sendRealtimeInput({
              audio: { data: msg.data, mimeType: "audio/pcm;rate=16000" },
            });
          }
        } else if (msg.type === "video") {
          if (session) {
            // Forward base64 JPEG frame to Gemini Live session
            session.sendRealtimeInput({
              video: { data: msg.data, mimeType: "image/jpeg" },
            });
          }
        }
      } catch (err: any) {
        console.error("Error processing client message:", err);
        clientWs.send(JSON.stringify({ type: "error", error: err.message || String(err) }));
      }
    });

    clientWs.on("close", () => {
      console.log("Client WebSocket closed");
      if (session) {
        try {
          session.close();
          console.log("Gemini Live session closed successfully on client disconnect");
        } catch (e) {
          console.error("Error closing Gemini Live session:", e);
        }
      }
    });
  });

  // Serve Vite files in development or compiled files in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT} (http://0.0.0.0:${PORT})`);
  });
}

startServer();
