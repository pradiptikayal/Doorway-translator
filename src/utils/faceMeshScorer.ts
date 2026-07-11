/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface FaceScores {
  frown: number;
  hesitation: number;
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export const estimateFacialScores = (result: any): FaceScores => {
  const categories = result.faceBlendshapes?.[0]?.categories ?? [];
  const getBlendshapeScore = (name: string) => categories.find((c: any) => c.categoryName === name)?.score ?? 0;

  // Frown: combines eye-brow lowering, mouth pulling down, and inner brow rising
  const browDownLeft = getBlendshapeScore("browDownLeft");
  const browDownRight = getBlendshapeScore("browDownRight");
  const mouthFrownLeft = getBlendshapeScore("mouthFrownLeft");
  const mouthFrownRight = getBlendshapeScore("mouthFrownRight");
  const browInnerUp = getBlendshapeScore("browInnerUp");

  const frown = clamp(
    0.4 * ((browDownLeft + browDownRight) / 2) +
    0.4 * ((mouthFrownLeft + mouthFrownRight) / 2) +
    0.2 * browInnerUp
  );

  // Hesitation: combines lip roll, lip press, eye squinting, and subtle mid-range jaw opening
  const mouthPressLeft = getBlendshapeScore("mouthPressLeft");
  const mouthPressRight = getBlendshapeScore("mouthPressRight");
  const mouthRollLower = getBlendshapeScore("mouthRollLower");
  const mouthRollUpper = getBlendshapeScore("mouthRollUpper");
  const eyeSquintLeft = getBlendshapeScore("eyeSquintLeft");
  const eyeSquintRight = getBlendshapeScore("eyeSquintRight");
  const jawOpen = getBlendshapeScore("jawOpen");

  // A subtle or hesitant half-open mouth: jaw slightly open, but not fully yawning/talking
  const midJawOpen = jawOpen > 0.05 && jawOpen < 0.45 ? 1 - Math.abs(jawOpen - 0.2) / 0.25 : 0;

  const hesitation = clamp(
    0.3 * ((mouthPressLeft + mouthPressRight) / 2) +
    0.3 * ((mouthRollLower + mouthRollUpper) / 2) +
    0.2 * ((eyeSquintLeft + eyeSquintRight) / 2) +
    0.2 * midJawOpen
  );

  return {
    frown: Math.round(frown * 100) / 100,
    hesitation: Math.round(hesitation * 100) / 100,
  };
};
