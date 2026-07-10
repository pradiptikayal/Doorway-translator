/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from "react";
import { 
  Mic, 
  MicOff, 
  Video, 
  VideoOff, 
  Languages, 
  Play, 
  Square, 
  Check, 
  AlertCircle, 
  Sparkles, 
  ChevronRight, 
  Volume2,
  Info,
  X
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

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
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "bn", name: "Bengali", nativeName: "বাংলা" }
];

export default function App() {
  const [langA, setLangA] = useState("English");
  const [langB, setLangB] = useState("Hindi");
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "listening" | "translating" | "clarifying" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Permissions state
  const [permissionState, setPermissionState] = useState<"prompt" | "granted" | "denied">("prompt");
  const [permissionError, setPermissionError] = useState<string | null>(null);

  // Mute controls
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraMuted, setIsCameraMuted] = useState(false);

  // Conversation history
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const utterancesRef = useRef<Utterance[]>([]);

  // DOM Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const utterancesEndRef = useRef<HTMLDivElement | null>(null);

  // WebSocket & Audio state refs (essential to avoid React stale closures)
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextInputRef = useRef<AudioContext | null>(null);
  const audioContextOutputRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const videoIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const activeAudioSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextStartTimeRef = useRef<number>(0);

  // Auto-scroll the transcript list when new entries appear
  useEffect(() => {
    utterancesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [utterances]);

  // Request camera and microphone access on load to check permissions
  useEffect(() => {
    checkPermissions();
    return () => {
      cleanupSession();
    };
  }, []);

  const checkPermissions = async () => {
    try {
      // Check if browser supports mediaDevices
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setPermissionState("denied");
        setPermissionError("This browser does not support microphone and camera access.");
        return;
      }

      // Query permission status if available (helps avoid prompt if already granted)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      // Clean up the initial test stream
      stream.getTracks().forEach(track => track.stop());
      setPermissionState("granted");
    } catch (err: any) {
      console.warn("Permissions not granted on initial check:", err);
      setPermissionState("prompt");
    }
  };

  const requestPermissions = async () => {
    try {
      setPermissionError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach(track => track.stop());
      setPermissionState("granted");
    } catch (err: any) {
      console.error("Failed to acquire microphone/camera permissions:", err);
      setPermissionState("denied");
      setPermissionError(
        err.name === "NotAllowedError" 
          ? "Permission was denied. Please allow camera and microphone access in your browser settings to use Doorway."
          : `Error acquiring media: ${err.message || String(err)}`
      );
    }
  };

  // Helper to check if translation is clarifying
  const checkClarification = (text: string) => {
    const lower = text.toLowerCase();
    return lower.includes("repeat") ||
           lower.includes("pardon") ||
           lower.includes("say that again") ||
           lower.includes("didn't catch") ||
           lower.includes("mumbled") ||
           lower.includes("overlapping") ||
           lower.includes("excuse me,");
  };

  // Local helper to append transcripts safely
  const handleIncomingTranscript = (sender: "user" | "model", text: string) => {
    const current = [...utterancesRef.current];
    const lastUtterance = current[current.length - 1];

    if (sender === "user") {
      // Start a new utterance bubble for a new speaker session
      // If the last utterance doesn't have model translation yet and is quite fresh, we can append to userText,
      // but usually a new userTurn starts a clean conversation pair.
      if (lastUtterance && lastUtterance.modelText === "" && (new Date().getTime() - lastUtterance.timestamp.getTime() < 8000)) {
        lastUtterance.userText = (lastUtterance.userText + " " + text).trim();
      } else {
        current.push({
          id: Math.random().toString(36).substr(2, 9),
          userText: text,
          modelText: "",
          timestamp: new Date()
        });
      }
      setStatus("listening");
    } else {
      // It's the model's translation
      if (lastUtterance) {
        lastUtterance.modelText = (lastUtterance.modelText + " " + text).trim();
      } else {
        current.push({
          id: Math.random().toString(36).substr(2, 9),
          userText: "",
          modelText: text,
          timestamp: new Date()
        });
      }

      // Check if translation is asking for clarification
      if (checkClarification(text)) {
        setStatus("clarifying");
      } else {
        setStatus("translating");
      }
    }

    utterancesRef.current = current;
    setUtterances(current);
  };

  const playAudioChunk = (base64Audio: string) => {
    try {
      if (!audioContextOutputRef.current) {
        audioContextOutputRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        nextStartTimeRef.current = audioContextOutputRef.current.currentTime;
      }

      const audioCtx = audioContextOutputRef.current;
      if (audioCtx.state === "suspended") {
        audioCtx.resume();
      }

      // Decode base64 raw PCM 24kHz
      const binary = atob(base64Audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768; // normalize
      }

      const audioBuffer = audioCtx.createBuffer(1, float32Array.length, 24000);
      audioBuffer.getChannelData(0).set(float32Array);

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);

      const currentTime = audioCtx.currentTime;
      if (nextStartTimeRef.current < currentTime) {
        nextStartTimeRef.current = currentTime;
      }

      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += audioBuffer.duration;

      activeAudioSourcesRef.current.push(source);
      source.onended = () => {
        activeAudioSourcesRef.current = activeAudioSourcesRef.current.filter(s => s !== source);
        // If no more output is playing, set status back to listening/idle
        if (activeAudioSourcesRef.current.length === 0) {
          setStatus("listening");
        }
      };
    } catch (err) {
      console.error("Error playing audio chunk:", err);
    }
  };

  const stopAllAudioPlayback = () => {
    activeAudioSourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // already stopped
      }
    });
    activeAudioSourcesRef.current = [];
    if (audioContextOutputRef.current) {
      nextStartTimeRef.current = audioContextOutputRef.current.currentTime;
    }
    setStatus("listening");
  };

  const startConversation = async () => {
    try {
      setErrorMessage(null);
      setStatus("connecting");
      setIsActive(true);
      setUtterances([]);
      utterancesRef.current = [];

      // Acquire media streams
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
        video: {
          width: { ideal: 320 },
          height: { ideal: 240 },
          facingMode: "user"
        }
      });

      mediaStreamRef.current = mediaStream;

      // Show video preview
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.play().catch(e => console.warn("Video play interrupted:", e));
      }

      // Establish WebSocket connection to backend
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/live`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connection established with Doorway server");
        // Send initial setup parameters
        ws.send(JSON.stringify({
          type: "setup",
          languageA: langA,
          languageB: langB
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          
          if (msg.type === "status" && msg.status === "connected") {
            setStatus("listening");
            startStreaming(mediaStream);
          } else if (msg.type === "audio") {
            playAudioChunk(msg.data);
          } else if (msg.type === "interrupted") {
            console.log("Model interrupted by new user speech. Stopping current playback.");
            stopAllAudioPlayback();
          } else if (msg.type === "transcript") {
            handleIncomingTranscript(msg.sender, msg.text);
          } else if (msg.type === "error") {
            console.error("Server reported error:", msg.error);
            setErrorMessage(msg.error);
            setStatus("error");
          }
        } catch (e) {
          console.error("Error parsing socket message:", e);
        }
      };

      ws.onclose = () => {
        console.log("WebSocket connection closed by server");
        cleanupSession();
      };

      ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        setErrorMessage("Lost connection to the Doorway server.");
        setStatus("error");
      };

    } catch (err: any) {
      console.error("Error starting conversation:", err);
      setErrorMessage(`Failed to start conversation: ${err.message || String(err)}`);
      setStatus("error");
      cleanupSession();
    }
  };

  const startStreaming = (stream: MediaStream) => {
    // 1. Audio stream processor (resamples / formats mic capture to 16kHz raw PCM)
    audioContextInputRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const audioCtx = audioContextInputRef.current;
    const source = audioCtx.createMediaStreamSource(stream);
    
    // Create ScriptProcessorNode with buffer size 4096, 1 input channel, 1 output channel
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    audioProcessorRef.current = processor;

    processor.onaudioprocess = (e) => {
      // If mic is muted, don't stream any audio
      if (isMicMuted || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const pcmBuffer = new Int16Array(inputData.length);
      
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcmBuffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      // Convert PCM Buffer to base64
      const bytes = new Uint8Array(pcmBuffer.buffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Audio = btoa(binary);

      wsRef.current.send(JSON.stringify({
        type: "audio",
        data: base64Audio
      }));
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);

    // 2. Camera stream processor (captures JPEG frame at 1 frame per second to prevent model overload)
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");

    videoIntervalRef.current = setInterval(() => {
      if (isCameraMuted || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA && ctx) {
        ctx.drawImage(videoRef.current, 0, 0, 320, 240);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.5); // 50% jpeg quality for lightweight streaming
        const base64Video = dataUrl.split(",")[1];

        wsRef.current.send(JSON.stringify({
          type: "video",
          data: base64Video
        }));
      }
    }, 1000); // exactly 1 frame per second (1 FPS)
  };

  const cleanupSession = () => {
    setIsActive(false);

    // Stop audio intervals & loops
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }

    // Stop and clear processor
    if (audioProcessorRef.current) {
      try {
        audioProcessorRef.current.disconnect();
      } catch (e) {}
      audioProcessorRef.current = null;
    }

    // Close Input Audio Context
    if (audioContextInputRef.current) {
      audioContextInputRef.current.close().catch(e => console.warn(e));
      audioContextInputRef.current = null;
    }

    // Close Output Audio Context
    if (audioContextOutputRef.current) {
      audioContextOutputRef.current.close().catch(e => console.warn(e));
      audioContextOutputRef.current = null;
    }

    // Stop tracks in MediaStream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    // Disconnect video srcObject
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    // Stop active audio playbacks
    activeAudioSourcesRef.current = [];

    // Close socket
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
  };

  const handleStop = () => {
    cleanupSession();
    setStatus("idle");
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col font-sans select-none overflow-hidden">
      {/* Primary Header */}
      <header className="border-b border-stone-200 bg-white relative z-10 py-5 px-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-stone-900 flex items-center justify-center">
            <div className="w-2.5 h-2.5 bg-white rotate-45"></div>
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-stone-950 font-display">
              Doorway
            </h1>
            <p className="text-[10px] text-stone-400 font-mono uppercase tracking-widest">ambient live translator</p>
          </div>
        </div>

        {/* Dynamic Status Badges */}
        {isActive && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 bg-stone-100 px-4 py-1.5 rounded-full text-stone-700 text-xs font-semibold uppercase tracking-wider font-mono">
              <span>{langA.substring(0, 2).toUpperCase()}</span>
              <div className="w-px h-3 bg-stone-300"></div>
              <span>{langB.substring(0, 2).toUpperCase()}</span>
            </div>
            <div className="flex items-center gap-2 bg-white px-3.5 py-1.5 rounded-full border border-stone-200 shadow-sm text-xs font-medium">
              {status === "connecting" && (
                <>
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></div>
                  <span className="text-stone-500 font-mono uppercase tracking-widest text-[10px]">Connecting...</span>
                </>
              )}
              {status === "listening" && (
                <>
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                  <span className="text-stone-500 font-mono uppercase tracking-widest text-[10px]">Live Session</span>
                </>
              )}
              {status === "translating" && (
                <>
                  <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
                  <span className="text-stone-500 font-mono uppercase tracking-widest text-[10px]">Translating...</span>
                </>
              )}
              {status === "clarifying" && (
                <>
                  <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></div>
                  <span className="text-stone-500 font-mono uppercase tracking-widest text-[10px]">Asking Speaker</span>
                </>
              )}
              {status === "error" && (
                <>
                  <div className="w-2 h-2 rounded-full bg-rose-500"></div>
                  <span className="text-stone-500 font-mono uppercase tracking-widest text-[10px]">Error</span>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Main Container */}
      <main className="flex-1 flex flex-col relative z-10 max-w-7xl w-full mx-auto px-10 py-8 overflow-hidden">
        
        {/* Permission Notification on Load */}
        {permissionState === "prompt" && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 bg-white border border-stone-200 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm"
          >
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-full bg-stone-100 text-stone-700 mt-0.5">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-stone-900 text-base font-display">Microphone & Camera Permissions Required</h3>
                <p className="text-sm text-stone-500 mt-1 max-w-2xl leading-relaxed">
                  Doorway requires real-time microphone audio for continuous speech translation and camera access to detect listener confusion (e.g., frowning or hesitation) and proactively adjust translation speed.
                </p>
              </div>
            </div>
            <button
              onClick={requestPermissions}
              className="whitespace-nowrap px-6 py-3 bg-stone-900 hover:bg-stone-800 transition active:scale-95 text-white text-sm font-medium rounded-full shadow-sm cursor-pointer"
            >
              Grant Access
            </button>
          </motion.div>
        )}

        {permissionState === "denied" && (
          <div className="mb-6 bg-rose-50 border border-rose-200 rounded-2xl p-6 flex items-start gap-4 shadow-sm">
            <div className="p-2.5 rounded-full bg-rose-100 text-rose-700">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-rose-900">Device Access Blocked</h3>
              <p className="text-sm text-rose-600 mt-1 leading-relaxed">
                {permissionError || "Camera and Microphone permissions were denied. Please enable them in your browser bar address settings and reload the app."}
              </p>
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          {!isActive ? (
            /* Setup Screen */
            <motion.div
              key="setup"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.3 }}
              className="flex-1 flex flex-col justify-center items-center max-w-2xl mx-auto w-full my-auto py-12"
            >
              <div className="text-center mb-10">
                <motion.div
                  animate={{ rotate: [0, 360] }}
                  transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
                  className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone-950 p-1 shadow-sm flex items-center justify-center"
                >
                  <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center">
                    <Languages className="w-6 h-6 text-stone-900" />
                  </div>
                </motion.div>
                <h2 className="text-3xl font-light tracking-tight text-stone-900 font-display">Ambient Conversation Translator</h2>
                <p className="text-stone-500 text-sm mt-3 leading-relaxed max-w-lg mx-auto">
                  Select two languages and click start. Place the device between both speakers. Doorway continuously listens, translates idioms naturally, and automatically slows down if someone looks confused.
                </p>
              </div>

              {/* Language Selection Grid */}
              <div className="w-full bg-white border border-stone-200 rounded-3xl p-8 shadow-sm mb-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
                  
                  {/* Selector A */}
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] font-mono text-stone-400 uppercase tracking-wider font-semibold">Speaker A Language</label>
                    <div className="relative">
                      <select
                        value={langA}
                        onChange={(e) => setLangA(e.target.value)}
                        className="w-full bg-stone-50 border border-stone-200 hover:border-stone-300 rounded-2xl px-4 py-3.5 text-sm text-stone-800 outline-none cursor-pointer appearance-none focus:border-stone-400 transition"
                      >
                        {SUPPORTED_LANGUAGES.map((lang) => (
                          <option key={lang.code} value={lang.name} disabled={lang.name === langB}>
                            {lang.name} ({lang.nativeName})
                          </option>
                        ))}
                      </select>
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-stone-400 text-xs">▼</div>
                    </div>
                  </div>

                  {/* Visual Connector */}
                  <div className="hidden md:flex absolute left-1/2 top-[55%] -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white border border-stone-200 items-center justify-center text-stone-400 z-10 shadow-sm">
                    <ChevronRight className="w-4 h-4" />
                  </div>

                  {/* Selector B */}
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] font-mono text-stone-400 uppercase tracking-wider font-semibold">Speaker B Language</label>
                    <div className="relative">
                      <select
                        value={langB}
                        onChange={(e) => setLangB(e.target.value)}
                        className="w-full bg-stone-50 border border-stone-200 hover:border-stone-300 rounded-2xl px-4 py-3.5 text-sm text-stone-800 outline-none cursor-pointer appearance-none focus:border-stone-400 transition"
                      >
                        {SUPPORTED_LANGUAGES.map((lang) => (
                          <option key={lang.code} value={lang.name} disabled={lang.name === langA}>
                            {lang.name} ({lang.nativeName})
                          </option>
                        ))}
                      </select>
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-stone-400 text-xs">▼</div>
                    </div>
                  </div>
                </div>

                {/* Micro and Camera Info Tips */}
                <div className="mt-6 pt-5 border-t border-stone-150 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-stone-500 font-mono">
                  <div className="flex items-center gap-2.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span>Real-time voice-to-voice stream</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span>Confusion detection from camera</span>
                  </div>
                </div>
              </div>

              {/* Start Session Action */}
              <button
                disabled={permissionState === "denied"}
                onClick={startConversation}
                className={`w-full max-w-md py-4 rounded-full font-semibold shadow-sm transition-all duration-300 flex items-center justify-center gap-3 active:scale-[0.98] ${
                  permissionState === "denied"
                    ? "bg-stone-200 text-stone-400 cursor-not-allowed border border-stone-200"
                    : "bg-stone-900 hover:bg-stone-800 text-white shadow-sm cursor-pointer"
                }`}
              >
                <Play className="w-5 h-5 fill-current" />
                <span>Start Session ({langA} ⟷ {langB})</span>
              </button>
            </motion.div>
          ) : (
            /* Active Live Conversation Screen */
            <motion.div
              key="active"
              initial={{ opacity: 0, scale: 0.99 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.99 }}
              className="flex-1 flex flex-col md:flex-row gap-6 overflow-hidden h-[65vh] min-h-[450px]"
            >
              {/* Left Column: Live Transcripts Timeline */}
              <div className="flex-1 flex flex-col bg-white border border-stone-200 rounded-3xl overflow-hidden shadow-sm relative">
                
                {/* Scrollable Conversation Thread */}
                <div className="flex-1 overflow-y-auto p-8 space-y-6 scrollbar-thin bg-stone-50/20">
                  {utterances.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-stone-500 text-sm py-24 text-center">
                      <motion.div
                        animate={{ scale: [1, 1.05, 1] }}
                        transition={{ duration: 3, repeat: Infinity }}
                        className="w-12 h-12 rounded-full bg-stone-50 border border-stone-200 flex items-center justify-center text-stone-700 mb-4 shadow-sm"
                      >
                        <Mic className="w-5 h-5" />
                      </motion.div>
                      <p className="font-mono font-medium">Listening for conversation...</p>
                      <p className="text-xs text-stone-400 mt-1.5 max-w-xs leading-relaxed">
                        Start speaking in {langA} or {langB}. Transcripts and ambient translations will appear here.
                      </p>
                    </div>
                  ) : (
                    utterances.map((utt, index) => {
                      const isLast = index === utterances.length - 1;
                      return (
                        <motion.div
                          key={utt.id}
                          initial={{ opacity: 0, y: 15 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="space-y-4 pb-6 border-b border-stone-100 last:border-b-0"
                        >
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            
                            {/* Left Panel: Spoken Original Speech (Speaker A) */}
                            <div className={`p-6 rounded-2xl border transition-all ${
                              isLast 
                                ? "bg-stone-50 border-stone-200" 
                                : "bg-stone-50/50 border-stone-100 opacity-60"
                            }`}>
                              <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-2 font-mono">
                                Speaker • {utt.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                              <p className="text-lg font-light leading-relaxed text-stone-800">
                                {utt.userText || (
                                  <span className="text-stone-400 font-mono italic text-sm">Listening for voice...</span>
                                )}
                              </p>
                            </div>

                            {/* Right Panel: Translated Output (Speaker B) */}
                            <div className={`p-6 rounded-2xl border transition-all ${
                              isLast 
                                ? "bg-white shadow-sm border-stone-200" 
                                : "bg-white/60 border-stone-100 opacity-60"
                            }`}>
                              <div className="flex justify-between items-start mb-2">
                                <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest font-mono">Translation</p>
                                {isLast && status === "clarifying" && (
                                  <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded font-bold uppercase tracking-tight font-mono">Adaptation: Clarification</span>
                                )}
                                {isLast && status === "translating" && (
                                  <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-bold uppercase tracking-tight font-mono">Adapting Cues</span>
                                )}
                              </div>
                              <p className="text-lg font-light leading-relaxed text-stone-850">
                                {utt.modelText || (
                                  <span className="text-stone-400 font-mono italic text-sm">Translating...</span>
                                )}
                              </p>
                              {isLast && status === "clarifying" && (
                                <div className="mt-4 pt-3 border-t border-stone-100">
                                  <p className="text-[11px] text-stone-400 italic">Reason: Audio cue detected speaker hesitation. Proactively requested simpler phrasing.</p>
                                </div>
                              )}
                            </div>

                          </div>
                        </motion.div>
                      );
                    })
                  )}
                  <div ref={utterancesEndRef} />
                </div>
              </div>

              {/* Right Column: Visual Preview, Status, Instructions */}
              <div className="w-full md:w-80 flex flex-col gap-6">
                
                {/* Camera / Video PIP Frame */}
                <div className="bg-white border border-stone-200 rounded-3xl overflow-hidden relative shadow-sm aspect-video md:aspect-square flex items-center justify-center bg-stone-100">
                  <video
                    ref={videoRef}
                    muted
                    playsInline
                    className={`w-full h-full object-cover transform -scale-x-100 ${isCameraMuted ? "hidden" : "block"}`}
                  />
                  {isCameraMuted && (
                    <div className="text-center p-4">
                      <VideoOff className="w-8 h-8 text-stone-400 mx-auto mb-2" />
                      <p className="text-xs text-stone-500 font-mono">Camera Muted</p>
                      <p className="text-[10px] text-stone-400 mt-1">Confusion detection is inactive</p>
                    </div>
                  )}
                  {/* Small floating identifier */}
                  <div className="absolute top-3 left-3 bg-stone-900 text-white text-[9px] font-mono uppercase tracking-wider px-2.5 py-1 rounded">
                    Camera Active (1 FPS)
                  </div>
                </div>

                {/* Status Card & Instructions */}
                <div className="bg-white border border-stone-200 rounded-3xl p-6 flex-1 flex flex-col gap-4 relative shadow-sm">
                  <div>
                    <h3 className="text-sm font-semibold text-stone-900 font-display">Live Translation Active</h3>
                    <p className="text-xs text-stone-400 mt-1 font-mono uppercase tracking-wider">
                      {langA} ⟷ {langB}
                    </p>
                  </div>

                  <div className="space-y-4 pt-3 border-t border-stone-100 flex-1">
                    <div className="flex gap-2.5 text-xs">
                      <div className="p-1 rounded bg-stone-100 text-stone-600 h-fit">
                        <Info className="w-3.5 h-3.5" />
                      </div>
                      <p className="text-stone-500 leading-relaxed">
                        Speak naturally. The translator detects which language is spoken and outputs the translation in the other.
                      </p>
                    </div>

                    <div className="flex gap-2.5 text-xs">
                      <div className="p-1 rounded bg-stone-100 text-stone-600 h-fit">
                        <Volume2 className="w-3.5 h-3.5" />
                      </div>
                      <p className="text-stone-500 leading-relaxed">
                        <strong>Natural Interruptions:</strong> Simply start speaking to cut off the translator. It will stop immediately to hear you.
                      </p>
                    </div>

                    <div className="flex gap-2.5 text-xs">
                      <div className="p-1 rounded bg-stone-100 text-stone-600 h-fit">
                        <Sparkles className="w-3.5 h-3.5" />
                      </div>
                      <p className="text-stone-500 leading-relaxed">
                        <strong>Confusion Response:</strong> If you or the listener frown or look confused on camera, translation will automatically slow down or rephrase itself simply.
                      </p>
                    </div>
                  </div>

                  {errorMessage && (
                    <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl text-xs text-rose-800 flex gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                      <p className="leading-relaxed">{errorMessage}</p>
                    </div>
                  )}
                </div>

              </div>

            </motion.div>
          )}
        </AnimatePresence>

      </main>

      {/* Primary Footer (Dynamic or Static) */}
      {isActive ? (
        <footer className="h-24 bg-white border-t border-stone-200 flex items-center justify-between px-10 relative z-10">
          <div className="flex items-center gap-6">
            <button 
              onClick={() => setIsCameraMuted(!isCameraMuted)} 
              className={`flex items-center gap-2 transition-colors cursor-pointer ${isCameraMuted ? "text-stone-400 hover:text-stone-600" : "text-stone-900 font-semibold"}`}
            >
              {isCameraMuted ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
              <span className="text-xs font-semibold uppercase tracking-widest font-mono">
                {isCameraMuted ? "Video Off" : "Video On"}
              </span>
            </button>
            <button 
              onClick={() => setIsMicMuted(!isMicMuted)} 
              className={`flex items-center gap-2 transition-colors cursor-pointer ${isMicMuted ? "text-stone-400 hover:text-stone-600" : "text-emerald-600 font-semibold"}`}
            >
              {isMicMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              <span className="text-xs font-semibold uppercase tracking-widest font-mono">
                {isMicMuted ? "Mic Muted" : "Listening"}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex gap-1 items-center">
              <div className="w-1 h-3 bg-stone-200 animate-pulse"></div>
              <div className={`w-1 h-5 transition-all ${status === "listening" || status === "translating" ? "bg-emerald-500" : "bg-stone-300"}`}></div>
              <div className="w-1 h-2 bg-stone-200 animate-pulse"></div>
              <div className="w-1 h-4 bg-stone-200 animate-pulse"></div>
            </div>
            <span className="text-sm font-medium text-stone-500 ml-2 font-mono">
              {status === "connecting" && "Establishing connection..."}
              {status === "listening" && "Doorway is processing..."}
              {status === "translating" && "Doorway is translating..."}
              {status === "clarifying" && "Analyzing confusion..."}
              {status === "error" && "Error occurred"}
            </span>
          </div>

          <button 
            onClick={handleStop}
            className="px-6 py-2.5 border-2 border-stone-900 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-stone-900 hover:text-white transition-all cursor-pointer"
          >
            End Conversation
          </button>
        </footer>
      ) : (
        <footer className="py-6 border-t border-stone-200 bg-white text-center relative z-10 text-[10px] font-mono text-stone-400">
          Doorway Ambient Live Translator • Powered by Gemini Live API
        </footer>
      )}
    </div>
  );
}
