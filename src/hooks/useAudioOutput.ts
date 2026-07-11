import { useRef } from "react";

export function useAudioOutput() {
  const audioContextOutputRef = useRef<AudioContext | null>(null);
  const activeAudioSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextStartTimeRef = useRef<number>(0);

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

  const playAudioChunk = (base64Audio: string, onEnded?: () => void) => {
    try {
      if (!audioContextOutputRef.current) {
        audioContextOutputRef.current = new (window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)({ sampleRate: 24000 });
        nextStartTimeRef.current = audioContextOutputRef.current.currentTime;
      }
      const audioCtx = audioContextOutputRef.current;
      if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => undefined);
      }

      const binary = atob(base64Audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i += 1) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      const audioBuffer = audioCtx.createBuffer(1, float32Array.length, 24000);
      audioBuffer.getChannelData(0).set(float32Array);

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);

      const currentTime = audioCtx.currentTime;
      let startTime = nextStartTimeRef.current;
      if (startTime < currentTime) {
        startTime = currentTime;
      }

      source.start(startTime);
      nextStartTimeRef.current = startTime + audioBuffer.duration;

      activeAudioSourcesRef.current.push(source);
      source.onended = () => {
        activeAudioSourcesRef.current = activeAudioSourcesRef.current.filter((s) => s !== source);
        if (onEnded) onEnded();
      };
    } catch (err) {
      console.error("Error playing audio chunk", err);
    }
  };

  const closeAudioOutput = () => {
    stopActivePlayback();
    if (audioContextOutputRef.current) {
      audioContextOutputRef.current.close().catch(() => undefined);
      audioContextOutputRef.current = null;
    }
  };

  return {
    audioContextOutputRef,
    activeAudioSourcesRef,
    playAudioChunk,
    stopActivePlayback,
    closeAudioOutput,
  };
}
