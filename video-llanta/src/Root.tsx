import { Composition, Folder } from "remotion";
import { Intro } from "./scenes/Intro";
import { Mixing } from "./scenes/Mixing";
import { Extrusion } from "./scenes/Extrusion";
import { Bead } from "./scenes/Bead";
import { Building } from "./scenes/Building";
import { Curing } from "./scenes/Curing";
import { XRay } from "./scenes/XRay";
import { Outro } from "./scenes/Outro";
import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH, sceneDuration } from "./timeline";
import { TireVideo } from "./TireVideo";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="LlantaRadial"
      component={TireVideo}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={TOTAL_FRAMES}
    />
    <Folder name="Escenas">
      <Composition
        id="Intro"
        component={Intro}
        width={WIDTH}
        height={HEIGHT}
        fps={FPS}
        durationInFrames={sceneDuration("Intro")}
      />
      <Composition
        id="Mezclado"
        component={Mixing}
        width={WIDTH}
        height={HEIGHT}
        fps={FPS}
        durationInFrames={sceneDuration("Mezclado")}
      />
      <Composition
        id="Extrusion"
        component={Extrusion}
        width={WIDTH}
        height={HEIGHT}
        fps={FPS}
        durationInFrames={sceneDuration("Extrusion")}
      />
      <Composition
        id="Talon"
        component={Bead}
        width={WIDTH}
        height={HEIGHT}
        fps={FPS}
        durationInFrames={sceneDuration("Talon")}
      />
      <Composition
        id="Construccion"
        component={Building}
        width={WIDTH}
        height={HEIGHT}
        fps={FPS}
        durationInFrames={sceneDuration("Construccion")}
      />
      <Composition
        id="Vulcanizado"
        component={Curing}
        width={WIDTH}
        height={HEIGHT}
        fps={FPS}
        durationInFrames={sceneDuration("Vulcanizado")}
      />
      <Composition
        id="Inspeccion"
        component={XRay}
        width={WIDTH}
        height={HEIGHT}
        fps={FPS}
        durationInFrames={sceneDuration("Inspeccion")}
      />
      <Composition
        id="Cierre"
        component={Outro}
        width={WIDTH}
        height={HEIGHT}
        fps={FPS}
        durationInFrames={sceneDuration("Cierre")}
      />
    </Folder>
  </>
);
