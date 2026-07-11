export interface Utterance {
  id: string;
  userText: string;
  modelText: string;
  timestamp: Date;
}

export type SessionState = "setup" | "waiting" | "active";
export type Role = "A" | "B";
export type Status = "idle" | "connecting" | "waiting" | "listening" | "translating" | "clarifying" | "error";
