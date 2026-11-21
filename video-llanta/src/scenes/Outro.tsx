import { ThreeCanvas } from "@remotion/three";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BrandLogos } from "../components/BrandLogos";
import { Backdrop, Progress, Scrims } from "../components/Overlay";
import { Env, Rig } from "../components/three-helpers";
import { FinishedTire } from "../components/Tires";
import outro from "../data/outro.json";
import { C, bodyFont, displayFont } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.16, 1, 0.3, 1);
type Track = (number[] | null)[];

const Body: React.FC<{ tr: number[] | null | undefined }> = ({ tr }) =>
  tr ? (
    <group
      position={[tr[0], tr[1], tr[2]]}
      quaternion={[tr[3], tr[4], tr[5], tr[6]]}
    >
      <FinishedTire shadows />
    </group>
  ) : null;

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const stack = outro.stack as { track: Track; impact: number | null }[];
  const roller = outro.roller.track as Track;
  const camZ = interpolate(frame, [0, 90], [9.4, 8.6], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const fadeOut = interpolate(frame, [78, 90], [0, 1], clamp);

  return (
    <AbsoluteFill>
      <Backdrop glow="rgba(255,122,26,0.14)" y="70%" />
      <ThreeCanvas width={width} height={height} shadows>
        <Env intensity={0.55} />
        <Rig
          position={[0.5, 2.3, camZ]}
          target={[0, 1.0, 0]}
          fov={38}
          shiftY={0.1}
        />
        <ambientLight intensity={0.2} />
        <directionalLight
          position={[-3, 7, 5]}
          intensity={2.6}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-4}
          shadow-camera-right={4}
          shadow-camera-top={5}
          shadow-camera-bottom={-3}
        />
        <pointLight
          position={[2, 1.5, -2]}
          intensity={16}
          color={C.heat}
          distance={8}
        />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[30, 30]} />
          <meshStandardMaterial
            color="#14171b"
            roughness={0.7}
            metalness={0.2}
          />
        </mesh>
        {stack.map((s, i) => (
          <Body key={i} tr={s.track[frame]} />
        ))}
        <Body tr={roller[frame]} />
      </ThreeCanvas>
      <Scrims />
      <AbsoluteFill style={{ padding: "150px 84px 0", pointerEvents: "none" }}>
        <div
          style={{
            fontFamily: displayFont,
            fontWeight: 800,
            fontSize: 150,
            lineHeight: 0.9,
            color: C.ink,
            opacity: interpolate(frame, [30, 44], [0, 1], {
              ...clamp,
              easing: ease,
            }),
            translate: interpolate(frame, [30, 44], ["0px 40px", "0px 0px"], {
              ...clamp,
              easing: ease,
            }),
          }}
        >
          DE CAUCHO
          <br />
          <span style={{ color: C.accent }}>A CARRETERA</span>
        </div>
        <div
          style={{
            fontFamily: bodyFont,
            fontWeight: 500,
            fontSize: 44,
            color: C.muted,
            marginTop: 26,
            opacity: interpolate(frame, [40, 54], [0, 1], {
              ...clamp,
              easing: ease,
            }),
          }}
        >
          Llanta radial para camión · 295/80 R22.5
        </div>
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          paddingBottom: 230,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            padding: "26px 44px",
            borderRadius: 26,
            background: "rgba(8,10,13,0.82)",
            border: "1px solid rgba(255,255,255,0.14)",
            opacity: interpolate(frame, [44, 54], [0, 1], {
              ...clamp,
              easing: ease,
            }),
          }}
        >
          <BrandLogos from={46} height={96} gap={40} />
        </div>
      </AbsoluteFill>
      <Progress step={7} />
      <AbsoluteFill style={{ background: "#000", opacity: fadeOut }} />
    </AbsoluteFill>
  );
};
