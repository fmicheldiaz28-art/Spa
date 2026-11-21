import { Audio } from "@remotion/media";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Fragment } from "react";
import { AbsoluteFill, staticFile } from "remotion";
import { Bead } from "./scenes/Bead";
import { Building } from "./scenes/Building";
import { Curing } from "./scenes/Curing";
import { Extrusion } from "./scenes/Extrusion";
import { Intro } from "./scenes/Intro";
import { Mixing } from "./scenes/Mixing";
import { Outro } from "./scenes/Outro";
import { XRay } from "./scenes/XRay";
import { SCENES, TRANSITION } from "./timeline";

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
    <Audio src={staticFile("audio/soundtrack.wav")} />
  </AbsoluteFill>
);
