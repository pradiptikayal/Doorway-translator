import { GoogleGenAI, Modality } from "@google/genai";
import { RoomState } from "./types";
import { CLARIFICATION_KEYWORDS } from "./config";

export function buildSystemInstruction(langA: string, langB: string, direction: "A_TO_B" | "B_TO_A") {
  const from = direction === "A_TO_B" ? langA : langB;
  const to = direction === "A_TO_B" ? langB : langA;
  return `You are Doorway, a live translation assistant. Translate naturally from ${from} to ${to}.
You will receive structured facial expression text signals from the listener's camera face analysis in the format: "[Listener Face State: frown=X, hesitation=Y]". Use these signals as context to understand if the listener is confused or struggling.
If the frown or hesitation scores are elevated (e.g. above 0.35), slow down, simplify your translation vocabulary, and inject a clarifying rephrase in the translation.
If the audio input is mumbled, noisy, or double-talk occurs, proactively and politely interrupt the conversation in the speaker's native language (${from}) to request a repetition rather than guessing.
Recognize non-literal or idiomatic phrases and format translations as: "That phrase doesn't translate directly — they said something like X, which roughly means Y."
Respond only with the translated spoken output or the clarification request.`;
}

export function extractTranscriptText(message: any): string {
  const parts = message.serverContent?.modelTurn?.parts ?? [];
  const partsText = parts
    .map((part: any) => part.text)
    .filter(Boolean)
    .join(" ");

  return [message.serverContent?.outputTranscription?.text, partsText]
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function looksLikeClarification(text: string): boolean {
  const normalized = text.toLowerCase();
  return CLARIFICATION_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export async function createTranslationSession(ai: GoogleGenAI, langA: string, langB: string, direction: "A_TO_B" | "B_TO_A", room: RoomState) {
  const sourceRole = direction === "A_TO_B" ? "A" : "B";
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
        const text = extractTranscriptText(message);

        const targetParticipant = Array.from(room.participants.values()).find((participant) => participant.role === targetRole);
        const sourceParticipant = Array.from(room.participants.values()).find((participant) => participant.role === sourceRole);

        if (audio && targetParticipant) {
          targetParticipant.ws.send(JSON.stringify({ type: "audio", data: audio }));
        }

        if (text && targetParticipant) {
          targetParticipant.ws.send(JSON.stringify({ type: "transcript", sender: "model", text }));
        }

        if (text && looksLikeClarification(text) && sourceParticipant) {
          sourceParticipant.ws.send(
            JSON.stringify({
              type: "clarification",
              message: "The other participant may need a slower or clearer explanation. Please repeat or rephrase.",
            }),
          );
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
