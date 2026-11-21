import timeline from "./data/timeline.json";

export const FPS = timeline.fps;
export const WIDTH = timeline.width;
export const HEIGHT = timeline.height;
export const TRANSITION = timeline.transition;
export const SCENES = timeline.scenes;

export const sceneDuration = (id: string): number => {
  const s = SCENES.find((x) => x.id === id);
  if (!s) throw new Error(`Escena desconocida: ${id}`);
  return s.duration;
};

export const TOTAL_FRAMES =
  SCENES.reduce((acc, s) => acc + s.duration, 0) -
  TRANSITION * (SCENES.length - 1);
