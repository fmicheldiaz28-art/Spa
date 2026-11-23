import { Audio } from "@remotion/media";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Fragment } from "react";
import { AbsoluteFill, interpolate, staticFile } from "remotion";
import { Bead } from "./scenes/Bead";
import { Building } from "./scenes/Building";
import { Curing } from "./scenes/Curing";
import { Extrusion } from "./scenes/Extrusion";
import { Intro } from "./scenes/Intro";
import { Mixing } from "./scenes/Mixing";
import { Outro } from "./scenes/Outro";
import { XRay } from "./scenes/XRay";
import narration from "./data/narration.json";
import { FPS, SCENES, TOTAL_FRAMES, TRANSITION } from "./timeline";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 0 → sin voz, 1 → hablando (con rampas suaves) para bajar música y efectos. */
const voiceActivity = (f: number) => {
  const t = f / FPS;
  let v = 0;
  for (const c of narration.clips) {
    v = Math.max(
      v,
      interpolate(
        t,
        [c.start - 0.2, c.start - 0.05, c.end + 0.1, c.end + 0.35],
        [0, 1, 1, 0],
        clamp,
      ),
    );
  }
  return v;
};

const COMPONENTS: Record<string, React.FC> = {
  Intro,
  Mezclado: Mixing,
  Extrusion,
  Talon: Bead,
  Construccion: Building,
  Vulcanizado: Curing,
  Inspeccion: XRay,
  Cierre: Outro,
};

export const TireVideo: React.FC = () => (
  <AbsoluteFill style={{ background: "#000" }}>
    <TransitionSeries>
      {SCENES.map((s, i) => {
        const Scene = COMPONENTS[s.id];
        return (
          <Fragment key={s.id}>
            {i > 0 ? (
              <TransitionSeries.Transition
                presentation={fade()}
                timing={linearTiming({ durationInFrames: TRANSITION })}
              />
            ) : null}
            <TransitionSeries.Sequence
              name={s.id}
              durationInFrames={s.duration}
            >
              <Scene />
            </TransitionSeries.Sequence>
          </Fragment>
        );
      })}
    </TransitionSeries>
    {/* Música generada con Higgsfield (ElevenLabs Music v2.5, instrumental) */}
    <Audio
      src={staticFile("audio/music.mp3")}
      volume={(f) =>
        0.8 *
        (1 - 0.6 * voiceActivity(f)) *
        interpolate(f, [TOTAL_FRAMES - 15, TOTAL_FRAMES - 1], [1, 0], clamp)
      }
    />
    {/* Efectos sintetizados y sincronizados con la animación y la física */}
    <Audio
      src={staticFile("audio/sfx.wav")}
      volume={(f) => 0.6 * (1 - 0.45 * voiceActivity(f))}
    />
    {/* Narración (Higgsfield TTS, voz "Isabella"), montada con scripts/make-narration.mjs */}
    <Audio src={staticFile("audio/narration.wav")} volume={1} />
  </AbsoluteFill>
);
