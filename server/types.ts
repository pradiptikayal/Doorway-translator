import { WebSocket } from "ws";

export interface RoomParticipant {
  ws: WebSocket;
  role: "A" | "B";
  id: string;
  lastScores?: {
    frown: number;
    hesitation: number;
    smile: number;
    surprise: number;
  };
  lastAudioTime?: number;
  sentScoresForCurrentTurn?: boolean;
}

export interface RoomState {
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
