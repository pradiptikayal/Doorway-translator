/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Languages, Mic, MicOff, Play, Sparkles, Video, VideoOff, Volume2, Info } from "lucide-react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { estimateFacialScores, FaceScores } from "./utils/faceMeshScorer";

interface Utterance {
  id: string;
  userText: string;
  modelText: string;
  timestamp: Date;
}

const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt" },
  { code: "th", name: "Thai", nativeName: "ไทย" },
];

type SessionState = "setup" | "waiting" | "active";
type Role = "A" | "B";

type Status = "idle" | "connecting" | "waiting" | "listening" | "translating" | "clarifying" | "error";

export default function App() {
  const [langA, setLangA] = useState("English");
  const [langB, setLangB] = useState("Hindi");
  const [roomId, setRoomId] = useState("doorway-room");
  const [role, setRole] = useState<Role>("A");

  const [sessionState, setSessionState] = useState<SessionState>("setup");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
  const audioContextOutputRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const faceAnalysisIntervalRef = useRef<number | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const activeAudioSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextStartTimeRef = useRef<number>(0);
  const lastClarificationRequestAtRef = useRef<number>(0);
  const [faceScores, setFaceScores] = useState<FaceScores>({
    frown: 0,
    hesitation: 0,
  });
  const lastSentScoresRef = useRef<FaceScores | null>(null);

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

  const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

  const initializeFaceLandmarker = async () => {
    if (faceLandmarkerRef.current) return faceLandmarkerRef.current;

    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm");
    faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(
      vision,
      {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: 0.45,
        minFacePresenceConfidence: 0.45,
        minTrackingConfidence: 0.45,
        outputFaceBlendshapes: true,
      }
    );

    return faceLandmarkerRef.current;
  };



  const checkClarification = (text: string) => {
    const lower = text.toLowerCase();
    return lower.includes("repeat") || lower.includes("pardon") || lower.includes("say that again") || lower.includes("didn't catch") || lower.includes("mumbled") || lower.includes("overlapping") || lower.includes("excuse me,");
  };

  const handleIncomingTranscript = (sender: "user" | "model", text: string) => {
    const current = [...utterancesRef.current];
    const lastUtterance = current[current.length - 1];

    if (sender === "user") {
      if (lastUtterance && lastUtterance.modelText === "" && Date.now() - lastUtterance.timestamp.getTime() < 8000) {
        lastUtterance.userText = (lastUtterance.userText + " " + text).trim();
      } else {
        current.push({ id: Math.random().toString(36).slice(2, 9), userText: text, modelText: "", timestamp: new Date() });
      }
      setStatus("listening");
    } else {
      if (lastUtterance) {
        lastUtterance.modelText = (lastUtterance.modelText + " " + text).trim();
      } else {
        current.push({ id: Math.random().toString(36).slice(2, 9), userText: "", modelText: text, timestamp: new Date() });
      }
      setStatus(checkClarification(text) ? "clarifying" : "translating");
    }

    utterancesRef.current = current;
    setUtterances(current);
  };

  const playAudioChunk = (base64Audio: string) => {
    try {
      if (!audioContextOutputRef.current) {
        audioContextOutputRef.current = new (window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)({ sampleRate: 24000 });
        nextStartTimeRef.current = audioContextOutputRef.current.currentTime;
      }

      const audioCtx = audioContextOutputRef.current;
      if (audioCtx.state === "suspended") audioCtx.resume();

      const binary = atob(base64Audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i += 1) float32Array[i] = int16Array[i] / 32768;

      const audioBuffer = audioCtx.createBuffer(1, float32Array.length, 24000);
      audioBuffer.getChannelData(0).set(float32Array);
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);

      const currentTime = audioCtx.currentTime;
      if (nextStartTimeRef.current < currentTime) nextStartTimeRef.current = currentTime;
      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += audioBuffer.duration;

      activeAudioSourcesRef.current.push(source);
      source.onended = () => {
        activeAudioSourcesRef.current = activeAudioSourcesRef.current.filter((item) => item !== source);
        if (activeAudioSourcesRef.current.length === 0) setStatus("listening");
      };
    } catch (err) {
      console.error("Error playing audio chunk", err);
    }
  };

  const stopActivePlayback = () => {
    if (activeAudioSourcesRef.current.length > 0) {
      activeAudioSourcesRef.current.forEach((source) => {
        try {
          source.stop();
        } catch (e) {}
      });
      activeAudioSourcesRef.current = [];
    }

    if (audioContextOutputRef.current) {
      nextStartTimeRef.current = audioContextOutputRef.current.currentTime;
    }
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

    if (audioContextOutputRef.current) {
      audioContextOutputRef.current.close().catch(() => undefined);
      audioContextOutputRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    stopActivePlayback();

    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
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
        ws.send(JSON.stringify({ type: "join_room", roomId, role, languageA: langA, languageB: langB }));
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
          } else if (msg.type === "audio") {
            playAudioChunk(msg.data);
          } else if (msg.type === "transcript") {
            handleIncomingTranscript(msg.sender, msg.text);
          } else if (msg.type === "interrupt") {
            stopActivePlayback();
            setStatus("listening");
          } else if (msg.type === "clarification") {
            setStatus("clarifying");
            setErrorMessage(msg.message || "Please slow down or repeat for clarity.");
          } else if (msg.type === "error") {
            console.error("Server reported error", msg.error);
            setErrorMessage(msg.error);
            setStatus("error");
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
      };
    } catch (err: any) {
      console.error("Error starting conversation", err);
      setErrorMessage(err.message || String(err));
      setStatus("error");
      cleanupSession();
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
          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="rounded-full bg-stone-100 px-3 py-1">Room {roomId}</span>
            <span className="rounded-full bg-stone-100 px-3 py-1">Role {role}</span>
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
          <div className="mx-auto flex max-w-3xl flex-col gap-6 rounded-3xl border border-stone-200 bg-white p-8 shadow-sm">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-stone-900 text-white">
                <Languages className="h-7 w-7" />
              </div>
              <h2 className="text-2xl font-semibold text-stone-900">Two-phone live translation</h2>
              {/* Mirrors the Speaker A/B language selection below, so it never drifts out of sync with the Device role options. */}
              <p className="mt-2 text-sm text-stone-500">Open this page on both phones, use the same room code, and one device can be the {langA} side while the other is the {langB} side.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-medium text-stone-700">
                Room code
                <input value={roomId} onChange={(event) => setRoomId(event.target.value)} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none" />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-stone-700">
                Device role
                {/* Options track langA/langB directly instead of hardcoded language names, so this always matches whatever the Speaker A/B dropdowns have selected. */}
                <select value={role} onChange={(event) => setRole(event.target.value as Role)} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none">
                  <option value="A">{langA} speaker</option>
                  <option value="B">{langB} speaker</option>
                </select>
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-medium text-stone-700">
                Speaker A language
                <select value={langA} onChange={(event) => setLangA(event.target.value)} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none">
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.name} disabled={lang.name === langB}>{lang.name} ({lang.nativeName})</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-stone-700">
                Speaker B language
                <select value={langB} onChange={(event) => setLangB(event.target.value)} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none">
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.name} disabled={lang.name === langA}>{lang.name} ({lang.nativeName})</option>
                  ))}
                </select>
              </label>
            </div>

            <button onClick={() => void startConversation()} className="rounded-full bg-stone-900 px-6 py-3 font-semibold text-white" disabled={permissionState === "denied"}>
              <span className="flex items-center justify-center gap-2">
                <Play className="h-4 w-4" />
                Join room
              </span>
            </button>
          </div>
        ) : (
          <div className="flex h-full flex-col gap-6 lg:flex-row">
            <div className="flex-1 rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-widest text-stone-400">Conversation</p>
                  <h3 className="text-lg font-semibold text-stone-900">{sessionState === "waiting" ? "Waiting for the second phone..." : "Live translation"}</h3>
                </div>
                <div className="rounded-full bg-stone-100 px-3 py-1 text-xs font-mono text-stone-600">{status}</div>
              </div>
              <div className="h-[420px] overflow-y-auto rounded-2xl bg-stone-50 p-4">
                {utterances.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-center text-sm text-stone-500">
                    <div>
                      <Mic className="mx-auto mb-3 h-8 w-8 text-stone-400" />
                      <p>Speak naturally.</p>
                      <p className="mt-1 text-xs">Your translated speech and the partner’s translation will appear here.</p>
                    </div>
                  </div>
                ) : (
                  utterances.map((utterance) => (
                    <div key={utterance.id} className="mb-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                      <p className="text-xs uppercase tracking-widest text-stone-400">Spoken</p>
                      <p className="mt-1 text-sm text-stone-800">{utterance.userText || "Listening..."}</p>
                      <p className="mt-4 text-xs uppercase tracking-widest text-stone-400">Translated</p>
                      <p className="mt-1 text-sm text-stone-800">{utterance.modelText || "Waiting for translation..."}</p>
                    </div>
                  ))
                )}
                <div ref={utterancesEndRef} />
              </div>
            </div>

            <div className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-4 shadow-sm lg:w-80">
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
                        <span>😟 Frown</span>
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
                        <span>🤔 Hesitation</span>
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

              <div className="mt-4 rounded-2xl border border-stone-200 p-4">
                <div className="flex items-center gap-2 text-sm text-stone-600">
                  <Volume2 className="h-4 w-4" />
                  <span>Audio is routed to the other phone, and your camera frames help the translation adapt for confusion.</span>
                </div>
                <div className="mt-3 flex items-start gap-2 text-sm text-stone-600">
                  <Info className="mt-0.5 h-4 w-4" />
                  <span>Use the same room code on both phones. Your camera is analyzed locally, and only a compact confusion score is sent to the server.</span>
                </div>
              </div>

              {errorMessage && (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{errorMessage}</div>
              )}
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
