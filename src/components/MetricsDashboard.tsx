import React from "react";
import { Sparkles } from "lucide-react";
import { FaceScores } from "../utils/faceMeshScorer";

interface MetricsDashboardProps {
  faceScores: FaceScores;
  isCameraMuted: boolean;
}

export const MetricsDashboard: React.FC<MetricsDashboardProps> = ({ faceScores, isCameraMuted }) => {
  if (isCameraMuted) return null;

  return (
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
  );
};
