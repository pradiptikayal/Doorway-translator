/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Languages, Mic, MicOff, Play, Sparkles, Video, VideoOff, Volume2, Info, Copy, Check, Shuffle, LogIn, Lock } from "lucide-react";
import { estimateFacialScores, FaceScores } from "./utils/faceMeshScorer";
import { Utterance, SessionState, Role, Status } from "./types";
import { SUPPORTED_LANGUAGES } from "./config/languages";
import { useAudioOutput } from "./hooks/useAudioOutput";
import { useFaceLandmarker } from "./hooks/useFaceLandmarker";

const ADJECTIVES = ["swift", "clever", "bright", "silent", "warm", "cool", "calm", "bold", "kind", "grand", "mystic", "gentle"];
const NOUNS = ["panda", "fox", "otter", "breeze", "wave", "peak", "forest", "harbor", "haven", "river", "beacon", "doorway"];

function generateRandomRoomId() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(10 + Math.random() * 90);
  return `${adj}-${noun}-${num}`;
}

export default function App() {
  const [langA, setLangA] = useState("English");
  const [langB, setLangB] = useState("Hindi");
  const [roomId, setRoomId] = useState(() => generateRandomRoomId());
  const [role, setRole] = useState<Role>("A");

  const [sessionState, setSessionState] = useState<SessionState>("setup");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  interface LiveComment {
    id: string;
    message: string;
    timestamp: Date;
  }
  const [liveComments, setLiveComments] = useState<LiveComment[]>([]);

  const [passkey, setPasskey] = useState("");
  const [roomPasskey, setRoomPasskey] = useState("");

  // New setup states
  const [setupTab, setSetupTab] = useState<"create" | "join">("create");
  const [myLanguage, setMyLanguage] = useState("English");
  const [copied, setCopied] = useState(false);

  const [permissionState, setPermissionState] = useState<"prompt" | "granted" | "denied">("prompt");
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraMuted, setIsCameraMuted] = useState(false);

  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const utterancesRef = useRef<Utterance[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const utterancesEndRef = useRef<HTMLDivElement | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextInputRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const faceAnalysisIntervalRef = useRef<number | null>(null);
  const lastClarificationRequestAtRef = useRef<number>(0);

  const [faceScores, setFaceScores] = useState<FaceScores>({
    frown: 0,
    hesitation: 0,
  });
  const lastSentScoresRef = useRef<FaceScores | null>(null);

  const {
    audioContextOutputRef,
    activeAudioSourcesRef,
    playAudioChunk,
    stopActivePlayback,
    closeAudioOutput,
  } = useAudioOutput();

  const {
    faceLandmarkerRef,
    initializeFaceLandmarker,
    closeFaceLandmarker,
  } = useFaceLandmarker();

  useEffect(() => {
    utterancesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [utterances]);

  useEffect(() => {
    void checkPermissions();
    return () => {
      cleanupSession();
    };
  }, []);

  const checkPermissions = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPermissionState("denied");
        setPermissionError("This browser does not support microphone and camera access.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach((track) => track.stop());
      setPermissionState("granted");
    } catch (err: any) {
      setPermissionState("prompt");
      setPermissionError(err.message || "Please allow camera and microphone access.");
    }
  };

  const requestPermissions = async () => {
    try {
      setPermissionError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach((track) => track.stop());
      setPermissionState("granted");
    } catch (err: any) {
      setPermissionState("denied");
      setPermissionError(err.name === "NotAllowedError" ? "Permission was denied. Please allow camera and microphone access." : err.message || String(err));
    }
  };

  const handleRandomizeRoomId = () => {
    setRoomId(generateRandomRoomId());
  };

  const handleCopyInvite = () => {
    const inviteText = `Join my Doorway translation room!\nRoom Code: ${roomId}\nPasscode: ${roomPasskey}\nURL: ${window.location.origin}`;
    navigator.clipboard.writeText(inviteText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const checkClarification = (text: string) => {
    const lower = text.toLowerCase();
    return lower.includes("repeat") || lower.includes("pardon") || lower.includes("say that again") || lower.includes("didn't catch") || lower.includes("mumbled") || lower.includes("overlapping") || lower.includes("excuse me,");
  };

  const handleIncomingTranscript = (sender: "user" | "model", text: string, fromLang?: string, toLang?: string) => {
    const current = [...utterancesRef.current];
    const lastUtterance = current[current.length - 1];

    if (sender === "user") {
      if (lastUtterance && lastUtterance.modelText === "" && Date.now() - lastUtterance.timestamp.getTime() < 8000) {
        lastUtterance.userText = (lastUtterance.userText + " " + text).trim();
        if (fromLang) lastUtterance.fromLang = fromLang;
        if (toLang) lastUtterance.toLang = toLang;
      } else {
        current.push({
          id: Math.random().toString(36).slice(2, 9),
          userText: text,
          modelText: "",
          fromLang,
          toLang,
          timestamp: new Date()
        });
      }
      setStatus("listening");
    } else {
      if (lastUtterance) {
        lastUtterance.modelText = (lastUtterance.modelText + " " + text).trim();
        if (fromLang) lastUtterance.fromLang = fromLang;
        if (toLang) lastUtterance.toLang = toLang;
      } else {
        current.push({
          id: Math.random().toString(36).slice(2, 9),
          userText: "",
          modelText: text,
          fromLang,
          toLang,
          timestamp: new Date()
        });
      }
      setStatus(checkClarification(text) ? "clarifying" : "translating");
    }

    utterancesRef.current = current;
    setUtterances(current);
  };

  const cleanupSession = () => {
    if (faceAnalysisIntervalRef.current) {
      clearInterval(faceAnalysisIntervalRef.current);
      faceAnalysisIntervalRef.current = null;
    }

    if (audioProcessorRef.current) {
      try {
        audioProcessorRef.current.disconnect();
      } catch (e) {}
      audioProcessorRef.current = null;
    }

    if (audioContextInputRef.current) {
      audioContextInputRef.current.close().catch(() => undefined);
      audioContextInputRef.current = null;
    }

    closeAudioOutput();
    closeFaceLandmarker();

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
    setRoomPasskey("");
  };

  const startConversation = async () => {
    try {
      setErrorMessage(null);
      setStatus("connecting");
      setSessionState("waiting");
      setUtterances([]);
      utterancesRef.current = [];

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not support microphone and camera access.");
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
        video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: "user" },
      });
      mediaStreamRef.current = mediaStream;

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        void videoRef.current.play().catch(() => undefined);
      }

      try {
        await initializeFaceLandmarker();
      } catch (error) {
        console.warn("Face landmarking is unavailable; continuing with translation-only mode.", error);
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/live`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: "join_room",
          roomId: roomId.trim(),
          passkey: setupTab === "join" ? passkey.trim() : "",
          myLanguage,
          action: setupTab,
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "room_status") {
            if (msg.status === "ready") {
              setStatus("listening");
              setSessionState("active");
              startStreaming(mediaStream);
            } else {
              setStatus("waiting");
              setSessionState("waiting");
            }

            if (msg.role) setRole(msg.role);
            if (msg.passkey) setRoomPasskey(msg.passkey);
            if (msg.languageA) setLangA(msg.languageA);
            if (msg.languageB) setLangB(msg.languageB);
          } else if (msg.type === "audio") {
            playAudioChunk(msg.data, () => {
              if (activeAudioSourcesRef.current.length === 0) setStatus("listening");
            });
          } else if (msg.type === "transcript") {
            handleIncomingTranscript(msg.sender, msg.text, msg.fromLang, msg.toLang);
          } else if (msg.type === "interrupt") {
            stopActivePlayback();
            setStatus("listening");
          } else if (msg.type === "clarification") {
            const commentId = `${Date.now()}-${Math.random()}`;
            setLiveComments((prev) => [...prev, { id: commentId, message: msg.message, timestamp: new Date() }]);
            setTimeout(() => {
              setLiveComments((prev) => prev.filter((c) => c.id !== commentId));
            }, 8000);
          } else if (msg.type === "error") {
            console.error("Server reported error", msg.error);
            setErrorMessage(msg.error);
            setStatus("error");
            cleanupSession();
            setSessionState("setup");
            setStatus("idle");
          }
        } catch (err) {
          console.error("Error parsing socket message", err);
        }
      };

      ws.onclose = () => {
        console.log("WebSocket closed");
        cleanupSession();
        setSessionState("setup");
        setStatus("idle");
      };

      ws.onerror = () => {
        setErrorMessage("Lost connection to the Doorway server.");
        setStatus("error");
        cleanupSession();
        setSessionState("setup");
        setStatus("idle");
      };
    } catch (err: any) {
      console.error("Error starting conversation", err);
      setErrorMessage(err.message || String(err));
      setStatus("error");
      cleanupSession();
      setSessionState("setup");
      setStatus("idle");
    }
  };

  const startStreaming = (stream: MediaStream) => {
    audioContextInputRef.current = new (window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)({ sampleRate: 16000 });
    const audioCtx = audioContextInputRef.current;
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    audioProcessorRef.current = processor;

    processor.onaudioprocess = (event) => {
      if (isMicMuted || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      const inputData = event.inputBuffer.getChannelData(0);
      let energy = 0;
      for (let i = 0; i < inputData.length; i += 1) {
        const sample = inputData[i];
        energy += sample * sample;
      }
      const rms = Math.sqrt(energy / inputData.length);

      if (activeAudioSourcesRef.current.length > 0 && rms > 0.08) {
        stopActivePlayback();
        wsRef.current.send(JSON.stringify({ type: "interrupt", roomId }));
      }

      if (rms < 0.015 && Date.now() - lastClarificationRequestAtRef.current > 4000 && !isMicMuted) {
        lastClarificationRequestAtRef.current = Date.now();
        wsRef.current.send(JSON.stringify({ type: "clarification_request", roomId, reason: "low_confidence" }));
      }

      const pcmBuffer = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i += 1) {
        const sample = Math.max(-1, Math.min(1, inputData[i]));
        pcmBuffer[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }

      const bytes = new Uint8Array(pcmBuffer.buffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]);
      const base64Audio = btoa(binary);

      wsRef.current.send(JSON.stringify({ type: "audio", roomId, data: base64Audio }));
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);

    faceAnalysisIntervalRef.current = window.setInterval(() => {
      if (isCameraMuted || !videoRef.current || !faceLandmarkerRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      if (videoRef.current.readyState < videoRef.current.HAVE_CURRENT_DATA) return;

      const result = faceLandmarkerRef.current.detectForVideo(videoRef.current, performance.now());
      const scores = estimateFacialScores(result);
      setFaceScores(scores);

      const last = lastSentScoresRef.current;
      const hasChanged = !last ||
        Math.abs(scores.frown - last.frown) > 0.08 ||
        Math.abs(scores.hesitation - last.hesitation) > 0.08;

      if (!hasChanged) return;

      lastSentScoresRef.current = scores;
      wsRef.current.send(JSON.stringify({ type: "face_expression", roomId, scores }));
    }, 1500);
  };

  const handleStop = () => {
    cleanupSession();
    setSessionState("setup");
    setStatus("idle");
  };

  const myActiveLanguage = role === "A" ? langA : langB;
  const partnerActiveLanguage = role === "A" ? langB : langA;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col font-sans overflow-hidden">
      <header className="border-b border-stone-200 bg-white px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-stone-900 flex items-center justify-center">
            <div className="w-2.5 h-2.5 bg-white rotate-45" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Doorway</h1>
            <p className="text-[10px] uppercase tracking-widest text-stone-400">two-phone room translator</p>
          </div>
        </div>
        {sessionState !== "setup" && (
          <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono">
            <span className="rounded-full bg-stone-100 px-3 py-1 flex items-center gap-1.5 text-stone-600">
              <span className="w-1.5 h-1.5 rounded-full bg-stone-400" />
              Room: <strong className="text-stone-900">{roomId}</strong>
            </span>
            {roomPasskey && (
              <span className="rounded-full bg-amber-50 border border-amber-200 px-3 py-1 flex items-center gap-1.5 text-amber-800">
                <Sparkles className="h-3 w-3 text-amber-500 animate-pulse" />
                Passcode: <strong className="text-amber-950 font-bold tracking-wider">{roomPasskey}</strong>
              </span>
            )}
            <span className="rounded-full bg-stone-100 px-3 py-1 text-stone-600">
              Me: <strong className="text-stone-900">{myActiveLanguage}</strong>
            </span>
            <span className="rounded-full bg-stone-100 px-3 py-1 text-stone-600">
              Partner: <strong className="text-stone-900">{sessionState === "active" ? partnerActiveLanguage : "Connecting..."}</strong>
            </span>
          </div>
        )}
      </header>

      <main className="flex-1 overflow-hidden px-4 py-6 md:px-8 lg:px-10">
        {permissionState === "prompt" && (
          <div className="mb-6 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-5 w-5 text-stone-700" />
              <div>
                <h3 className="font-semibold text-stone-900">Microphone and camera access are needed</h3>
                <p className="mt-1 text-sm text-stone-500">Allow access so the app can stream your audio and your listener’s facial cues.</p>
              </div>
            </div>
            <button onClick={requestPermissions} className="mt-4 rounded-full bg-stone-900 px-5 py-2 text-sm font-medium text-white">Grant Access</button>
          </div>
        )}

        {permissionState === "denied" && (
          <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-700">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5" />
              <div>
                <h3 className="font-semibold">Camera and microphone access were blocked</h3>
                <p className="mt-1 text-sm">Please allow them in your browser and reload the page.</p>
              </div>
            </div>
          </div>
        )}

        {sessionState === "setup" ? (
          <div className="mx-auto flex max-w-lg flex-col gap-6 rounded-3xl border border-stone-200 bg-white p-8 shadow-sm">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-stone-900 text-white">
                <Languages className="h-7 w-7" />
              </div>
              <h2 className="text-2xl font-semibold text-stone-900">Two-phone live translation</h2>
              <p className="mt-2 text-sm text-stone-500">Bridge two phones in a private room. Speak naturally in your own language, and hear the translation instantly.</p>
            </div>

            {/* Segmented Tab Selector */}
            <div className="flex rounded-xl bg-stone-100 p-1 border border-stone-200/50">
              <button
                onClick={() => setSetupTab("create")}
                className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all ${
                  setupTab === "create"
                    ? "bg-white text-stone-900 shadow-sm font-semibold"
                    : "text-stone-500 hover:text-stone-800"
                }`}
              >
                <Sparkles className="h-4 w-4 text-amber-500" />
                Create Room
              </button>
              <button
                onClick={() => setSetupTab("join")}
                className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all ${
                  setupTab === "join"
                    ? "bg-white text-stone-900 shadow-sm font-semibold"
                    : "text-stone-500 hover:text-stone-800"
                }`}
              >
                <LogIn className="h-4 w-4" />
                Join Room
              </button>
            </div>

            <div className="space-y-4">
              {setupTab === "create" ? (
                <>
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-stone-700">Room Code</span>
                    <div className="flex items-center gap-2">
                      <input
                        value={roomId}
                        onChange={(event) => setRoomId(event.target.value.toLowerCase().replace(/\s+/g, "-"))}
                        className="flex-1 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none font-mono text-stone-800"
                        placeholder="e.g. swift-haven-48"
                      />
                      <button
                        onClick={handleRandomizeRoomId}
                        title="Generate random room code"
                        className="p-3 rounded-2xl border border-stone-200 hover:bg-stone-100 text-stone-500 hover:text-stone-800 transition-colors"
                      >
                        <Shuffle className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium text-stone-700">My Language</label>
                    <select
                      value={myLanguage}
                      onChange={(event) => setMyLanguage(event.target.value)}
                      className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none text-stone-800"
                    >
                      {SUPPORTED_LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.name}>
                          {lang.name} ({lang.nativeName})
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={() => void startConversation()}
                    className="mt-2 w-full rounded-full bg-stone-900 hover:bg-stone-800 py-3.5 font-semibold text-white transition-colors"
                    disabled={permissionState === "denied"}
                  >
                    <span className="flex items-center justify-center gap-2">
                      <Play className="h-4 w-4" />
                      Create & Join Room
                    </span>
                  </button>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium text-stone-700">Room Code</label>
                    <input
                      value={roomId}
                      onChange={(event) => setRoomId(event.target.value.toLowerCase().replace(/\s+/g, "-"))}
                      className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none font-mono text-stone-800"
                      placeholder="e.g. swift-haven-48"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium text-stone-700">6-Digit Passcode</label>
                    <input
                      value={passkey}
                      onChange={(event) => setPasskey(event.target.value.trim())}
                      placeholder="Enter the passcode"
                      maxLength={6}
                      className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none font-mono tracking-widest placeholder:font-sans placeholder:tracking-normal text-stone-800"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium text-stone-700">My Language</label>
                    <select
                      value={myLanguage}
                      onChange={(event) => setMyLanguage(event.target.value)}
                      className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none text-stone-800"
                    >
                      {SUPPORTED_LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.name}>
                          {lang.name} ({lang.nativeName})
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={() => void startConversation()}
                    className="mt-2 w-full rounded-full bg-stone-900 hover:bg-stone-800 py-3.5 font-semibold text-white transition-colors"
                    disabled={permissionState === "denied" || !roomId.trim() || !passkey.trim()}
                  >
                    <span className="flex items-center justify-center gap-2">
                      <LogIn className="h-4 w-4" />
                      Join Room
                    </span>
                  </button>
                </>
              )}
            </div>

            {errorMessage && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 text-center">{errorMessage}</div>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col gap-6 lg:flex-row">
            <div className="flex-1 rounded-3xl border border-stone-200 bg-white p-4 shadow-sm flex flex-col">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-widest text-stone-400">Conversation</p>
                  <h3 className="text-lg font-semibold text-stone-900">
                    {sessionState === "waiting" ? "Connecting room..." : "Live translation"}
                  </h3>
                </div>
                <div className="rounded-full bg-stone-100 px-3 py-1 text-xs font-mono text-stone-600">{status}</div>
              </div>

              {sessionState === "waiting" ? (
                /* Premium Waiting Dashboard */
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-stone-50 rounded-2xl border border-dashed border-stone-200 h-[420px]">
                  <div className="relative mb-6">
                    <div className="absolute inset-0 rounded-full bg-stone-950/10 animate-ping" />
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-stone-900 text-white shadow-sm">
                      <Sparkles className="h-6 w-6 animate-pulse text-amber-300" />
                    </div>
                  </div>

                  <h3 className="text-xl font-semibold text-stone-900">Waiting for your partner...</h3>
                  <p className="mt-1 text-sm text-stone-500 max-w-sm">
                    Share these credentials. Once they join with their chosen language, the translator will start.
                  </p>

                  <div className="mt-6 w-full max-w-md bg-white rounded-2xl border border-stone-200 p-5 shadow-sm space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex flex-col text-left">
                        <span className="text-[10px] uppercase tracking-wider text-stone-400 font-medium">Room Code</span>
                        <span className="mt-1 font-mono font-bold text-stone-900 bg-stone-100 px-3 py-2 rounded-xl text-center select-all">
                          {roomId}
                        </span>
                      </div>
                      <div className="flex flex-col text-left">
                        <span className="text-[10px] uppercase tracking-wider text-stone-400 font-medium">Passcode</span>
                        <span className="mt-1 font-mono font-extrabold text-amber-950 bg-amber-50 border border-amber-200/50 px-3 py-2 rounded-xl text-center select-all tracking-widest text-lg">
                          {roomPasskey || "------"}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={handleCopyInvite}
                      className={`w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold border transition-all ${
                        copied
                          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                          : "bg-stone-50 hover:bg-stone-100 border-stone-200 text-stone-700"
                      }`}
                    >
                      {copied ? (
                        <>
                          <Check className="h-4 w-4 text-emerald-600" />
                          Invitation Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4" />
                          Copy Invitation Details
                        </>
                      )}
                    </button>
                  </div>

                  <div className="mt-6 inline-flex items-center gap-2 bg-stone-100 px-4 py-2 rounded-full text-xs text-stone-600 border border-stone-200/40 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>
                      You are set to speak <strong className="text-stone-900">{myLanguage}</strong>
                    </span>
                  </div>
                </div>
              ) : (
                /* Active Translation Transcript Log */
                <div className="h-[420px] overflow-y-auto rounded-2xl bg-stone-50 p-4">
                  {utterances.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-center text-sm text-stone-500">
                      <div>
                        <Mic className="mx-auto mb-3 h-8 w-8 text-stone-400 animate-pulse" />
                        <p>Speak naturally in {myActiveLanguage}.</p>
                        <p className="mt-1 text-xs">Your speech and translated output will appear here live.</p>
                      </div>
                    </div>
                  ) : (
                    utterances.map((utterance) => (
                      <div key={utterance.id} className="mb-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                        <p className="text-xs uppercase tracking-widest text-stone-400">Spoken ({utterance.fromLang || myActiveLanguage})</p>
                        <p className="mt-1 text-sm text-stone-800">{utterance.userText || "Listening..."}</p>
                        <p className="mt-4 text-xs uppercase tracking-widest text-stone-400 font-semibold text-stone-600">Translated ({utterance.toLang || partnerActiveLanguage})</p>
                        <p className="mt-1 text-base text-stone-900 font-medium">{utterance.modelText || "Translating..."}</p>
                      </div>
                    ))
                  )}
                  <div ref={utterancesEndRef} />
                </div>
              )}
            </div>

            <div className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-4 shadow-sm lg:w-80 flex flex-col justify-between">
              <div>
                <div className="rounded-2xl bg-stone-100 p-3">
                  <video ref={videoRef} muted playsInline className={`h-56 w-full rounded-2xl object-cover ${isCameraMuted ? "hidden" : "block"}`} />
                  {isCameraMuted && <div className="flex h-56 items-center justify-center text-center text-sm text-stone-500">Camera muted</div>}
                </div>

                {!isCameraMuted && (
                  <div className="mt-4 rounded-2xl border border-stone-200 p-4 bg-stone-50">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3 flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-stone-700" />
                      Live Expression Metrics
                    </h4>
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-xs font-medium text-stone-700 mb-1">
                          <span>🤔 Frown</span>
                          <span>{Math.round(faceScores.frown * 100)}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-stone-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-stone-800 rounded-full transition-all duration-300 ease-out"
                            style={{ width: `${faceScores.frown * 100}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs font-medium text-stone-700 mb-1">
                          <span>🤨 Hesitation</span>
                          <span>{Math.round(faceScores.hesitation * 100)}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-stone-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-stone-800 rounded-full transition-all duration-300 ease-out"
                            style={{ width: `${faceScores.hesitation * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Partner Status HUD */}
                <div className="mt-4 rounded-2xl border border-stone-200 p-4 bg-stone-50">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-stone-700 animate-pulse" />
                    Partner Connection Status
                  </h4>
                  {liveComments.length === 0 ? (
                    <div className="flex items-center gap-2 text-sm text-emerald-700 font-medium bg-emerald-50/50 border border-emerald-100 p-2.5 rounded-xl">
                      <span className="flex h-2 w-2 rounded-full bg-emerald-500 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      </span>
                      <span>✨ Partner is following smoothly</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {liveComments.map((comment) => (
                        <div
                          key={comment.id}
                          className="flex items-start justify-between gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-100 p-2.5 rounded-xl shadow-sm transition-all duration-300"
                        >
                          <span>💬 {comment.message}</span>
                          <button
                            onClick={() => setLiveComments((prev) => prev.filter((c) => c.id !== comment.id))}
                            className="text-amber-500 hover:text-amber-700 font-bold px-1.5"
                            title="Dismiss alert"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-2xl border border-stone-200 p-4">
                  <div className="flex items-center gap-2 text-sm text-stone-600">
                    <Volume2 className="h-4 w-4 text-stone-400 shrink-0" />
                    <span>Audio is routed to the other phone, and your camera frames help the translation adapt for confusion.</span>
                  </div>
                  <div className="mt-3 flex items-start gap-2 text-sm text-stone-600 border-t border-stone-100 pt-3">
                    <Info className="mt-0.5 h-4 w-4 text-stone-400 shrink-0" />
                    <span>Use the same room code on both phones. The server will bridge the conversation.</span>
                  </div>
                  {roomPasskey && sessionState === "active" && (
                    <div className="mt-3 flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200/50 rounded-xl p-3">
                      <Sparkles className="mt-0.5 h-4 w-4 text-amber-500 shrink-0 animate-pulse" />
                      <div>
                        <span className="font-semibold block text-amber-900">Room Passkey: <code className="font-mono text-base font-bold bg-white px-2 py-0.5 rounded border border-amber-200/60 tracking-widest">{roomPasskey}</code></span>
                        <span className="text-xs text-amber-700 mt-0.5 block">Your partner enters this passkey to join your room.</span>
                      </div>
                    </div>
                  )}
                </div>

                {errorMessage && (
                  <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{errorMessage}</div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {sessionState !== "setup" ? (
        <footer className="border-t border-stone-200 bg-white px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-3">
              <button onClick={() => setIsCameraMuted((value) => !value)} className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm ${isCameraMuted ? "bg-stone-100 text-stone-500" : "bg-stone-900 text-white"}`}>
                {isCameraMuted ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
                {isCameraMuted ? "Video off" : "Video on"}
              </button>
              <button onClick={() => setIsMicMuted((value) => !value)} className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm ${isMicMuted ? "bg-stone-100 text-stone-500" : "bg-emerald-600 text-white"}`}>
                {isMicMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                {isMicMuted ? "Mic muted" : "Listening"}
              </button>
            </div>
            <button onClick={handleStop} className="rounded-full border border-stone-900 px-4 py-2 text-sm font-semibold text-stone-900">End session</button>
          </div>
        </footer>
      ) : (
        <footer className="border-t border-stone-200 bg-white px-6 py-4 text-center text-xs uppercase tracking-widest text-stone-400">Doorway • Powered by Gemini Live</footer>
      )}
    </div>
  );
}
