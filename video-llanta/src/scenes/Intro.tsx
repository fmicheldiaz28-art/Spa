import { ThreeCanvas } from "@remotion/three";
import { useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import * as THREE from "three";
import { BrandLogos } from "../components/BrandLogos";
import { Backdrop, Scrims } from "../components/Overlay";
import { Env, Rig } from "../components/three-helpers";
import { FinishedTire } from "../components/Tires";
import { mulberry32 } from "../lib/tire";
import { C, bodyFont, displayFont } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.16, 1, 0.3, 1);

const Dust: React.FC<{ frame: number }> = ({ frame }) => {
  const seeds = useMemo(() => {
    const r = mulberry32(3);
    return Array.from({ length: 160 }, () => [
      r() * 6 - 3,
      r() * 7 - 3.5,
      r() * 4 - 3,
      r(),
    ]);
  }, []);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(seeds.length * 3), 3),
    );
    return g;
  }, [seeds]);
  const arr = geo.getAttribute("position") as THREE.BufferAttribute;
  seeds.forEach(([x, y, z, s], i) => {
    const yy = ((y + 3.5 + frame * (0.006 + s * 0.01)) % 7) - 3.5;
    arr.setXYZ(i, x + Math.sin(frame * 0.03 + s * 10) * 0.08, yy, z);
  });
  arr.needsUpdate = true;
  return (
    <points geometry={geo}>
      <pointsMaterial
        color="#ffb070"
        size={0.025}
        transparent
        opacity={0.55}
        sizeAttenuation
      />
    </points>
  );
};

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const light = interpolate(frame, [0, 28], [0, 1], {
    ...clamp,
    easing: Easing.inOut(Easing.quad),
  });
  const camZ = interpolate(frame, [0, 90], [8.1, 6.9], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill>
      <Backdrop glow="rgba(255,110,20,0.16)" y="40%" />
      <ThreeCanvas width={width} height={height}>
        <Env intensity={0.7 * light} />
        <Rig position={[0.2, 0.15, camZ]} target={[0, -0.3, 0]} fov={38} />
        <ambientLight intensity={0.08} />
        <directionalLight
          position={[3, 1, 4]}
          intensity={0.6 * light}
          color="#cfe3ff"
        />
        <spotLight
          position={[-2.5, 3.5, 5]}
          angle={0.45}
          penumbra={0.9}
          intensity={220 * light}
          color="#fff2e2"
        />
        <pointLight
          position={[-1.4, 1.2, -1.6]}
          intensity={30 * light}
          color={C.heat}
          distance={8}
        />
        <pointLight
          position={[1.8, -1.2, -1.2]}
          intensity={14 * light}
          color="#ffb070"
          distance={7}
        />
        <FinishedTire
          position={[0, 0.35, 0]}
          rotation={[
            Math.PI / 2,
            0,
            interpolate(frame, [0, 90], [-0.55, -0.3]),
          ]}
        />
        <Dust frame={frame} />
      </ThreeCanvas>
      <Scrims />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 120 }}>
        <BrandLogos from={4} height={82} gap={36} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{ justifyContent: "flex-end", padding: "0 84px 250px" }}
      >
        <div
          style={{
            fontFamily: displayFont,
            fontWeight: 600,
            fontSize: 46,
            letterSpacing: 8,
            color: C.accent,
            opacity: interpolate(frame, [16, 30], [0, 1], {
              ...clamp,
              easing: ease,
            }),
            translate: interpolate(frame, [16, 30], ["0px 24px", "0px 0px"], {
              ...clamp,
              easing: ease,
            }),
          }}
        >
          ASÍ SE FABRICA
        </div>
        <div
          style={{
            fontFamily: displayFont,
            fontWeight: 800,
            fontSize: 138,
            lineHeight: 0.92,
            color: C.ink,
            marginTop: 12,
            opacity: interpolate(frame, [20, 36], [0, 1], {
              ...clamp,
              easing: ease,
            }),
            translate: interpolate(frame, [20, 36], ["0px 40px", "0px 0px"], {
              ...clamp,
              easing: ease,
            }),
          }}
        >
          UNA LLANTA RADIAL DE CAMIÓN
        </div>
        <div
          style={{
            fontFamily: bodyFont,
            fontWeight: 500,
            fontSize: 44,
            color: C.muted,
            marginTop: 26,
            opacity: interpolate(frame, [30, 44], [0, 1], {
              ...clamp,
              easing: ease,
            }),
          }}
        >
          6 pasos, de la materia prima a la carretera
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
