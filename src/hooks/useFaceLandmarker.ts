import { useRef } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

export function useFaceLandmarker() {
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);

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

  const closeFaceLandmarker = () => {
    if (faceLandmarkerRef.current) {
      try {
        faceLandmarkerRef.current.close();
      } catch (e) {}
      faceLandmarkerRef.current = null;
    }
  };

  return {
    faceLandmarkerRef,
    initializeFaceLandmarker,
    closeFaceLandmarker,
  };
}
