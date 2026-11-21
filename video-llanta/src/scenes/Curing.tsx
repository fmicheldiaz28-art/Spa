import { ThreeCanvas } from "@remotion/three";
import { useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  Backdrop,
  Chip,
  Progress,
  Scrims,
  StepHeader,
} from "../components/Overlay";
import { Env, Rig } from "../components/three-helpers";
import { FinishedTire, GreenTire } from "../components/Tires";
import { mulberry32 } from "../lib/tire";
import { C, displayFont, bodyFont } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const MOLD_R = 1.2;
const MOLD_H = 0.55;

const T = {
  close: [8, 36],
  heat: [40, 84],
  swap: 70,
  cool: [94, 112],
  open: [100, 122],
  lift: [118, 150],
} as const;

const Steam: React.FC<{ frame: number }> = ({ frame }) => {
  const parts = useMemo(() => {
    const r = mulberry32(11);
    return Array.from({ length: 110 }, () => ({
      a: r() * Math.PI * 2,
      birth: 42 + r() * 56,
      speed: 0.018 + r() * 0.02,
      size: 0.01 + r() * 0.018,
      drift: (r() - 0.5) * 0.01,
    }));
  }, []);
  return (
    <group>
      {parts.map((p, i) => {
        const age = frame - p.birth;
        if (age < 0 || age > 32) return null;
        const life = age / 32;
        const rr = MOLD_R + 0.02 + age * 0.006;
        return (
          <mesh
            key={i}
            position={[
              Math.cos(p.a) * rr + age * p.drift,
              age * p.speed,
              Math.sin(p.a) * rr,
            ]}
            scale={p.size * (1 + life * 2.2)}
          >
            <sphereGeometry args={[1, 10, 8]} />
            <meshBasicMaterial
              color="#e9eef2"
              transparent
              opacity={0.22 * (1 - life)}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
};

export const Curing: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const close = interpolate(frame, [T.close[0], T.close[1]], [0, 1], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const open = interpolate(frame, [T.open[0], T.open[1]], [0, 1], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const topY = MOLD_H / 2 + 2.6 * (1 - close) + 2.6 * open;
  const heat =
    interpolate(frame, [T.heat[0], T.heat[1]], [0, 1], clamp) *
    interpolate(frame, [T.cool[0], T.cool[1]], [1, 0.08], clamp);
  const temp = Math.round(
    interpolate(frame, [T.heat[0], T.heat[1]], [25, 175], {
      ...clamp,
      easing: Easing.out(Easing.quad),
    }),
  );
  const lift = interpolate(frame, [T.lift[0], T.lift[1]], [0, 1], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const tireHeat = interpolate(frame, [T.open[0], T.lift[1]], [0.18, 0], clamp);
  const camY = interpolate(frame, [0, 150], [3.1, 2.5]);

  const moldMat = (
    <meshStandardMaterial
      color="#3d424a"
      metalness={0.9}
      roughness={0.3}
      emissive="#ff2a00"
      emissiveIntensity={heat * 0.12}
    />
  );

  return (
    <AbsoluteFill>
      <Backdrop glow={`rgba(255,77,0,${0.08 + heat * 0.22})`} y="60%" />
      <ThreeCanvas width={width} height={height}>
        <Env intensity={0.7} />
        <Rig
          position={[0.6, camY, 4.9]}
          target={[0, -0.15, 0]}
          fov={46}
          shiftY={0.09}
        />
        <ambientLight intensity={0.25} />
        <directionalLight position={[2, 6, 4]} intensity={2.4} />
        <pointLight
          position={[0, 0.4, 2]}
          intensity={10 * heat}
          color={C.heat}
          distance={5}
        />

        {/* Molde inferior */}
        <mesh position={[0, -MOLD_H / 2, 0]}>
          <cylinderGeometry args={[MOLD_R, MOLD_R, MOLD_H, 64]} />
          {moldMat}
        </mesh>
        {/* Molde superior (sube/baja) */}
        <group position={[0, topY, 0]}>
          <mesh>
            <cylinderGeometry args={[MOLD_R, MOLD_R, MOLD_H, 64]} />
            {moldMat}
          </mesh>
          <mesh position={[0, MOLD_H / 2 + 1.2, 0]}>
            <cylinderGeometry args={[0.16, 0.16, 2.4, 20]} />
            <meshStandardMaterial
              color="#cfd5db"
              metalness={0.95}
              roughness={0.15}
            />
          </mesh>
        </group>
        {/* Línea de cierre incandescente */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[MOLD_R + 0.005, 0.014, 8, 96]} />
          <meshBasicMaterial
            color={C.heat}
            transparent
            opacity={heat * close * (1 - open)}
          />
        </mesh>
        {/* Columnas de la prensa */}
        {[-1.55, 1.55].map((x) => (
          <mesh key={x} position={[x, 0.9, -0.6]}>
            <cylinderGeometry args={[0.13, 0.13, 3.6, 20]} />
            <meshStandardMaterial
              color="#c2c8cf"
              metalness={0.95}
              roughness={0.18}
            />
          </mesh>
        ))}
        {/* Llanta: verde antes, terminada después del cambio (oculto con el molde cerrado) */}
        {frame < T.swap ? (
          <GreenTire
            position={[0, 0, 0]}
            emissive={C.heat}
            emissiveIntensity={heat * 0.25}
          />
        ) : (
          <FinishedTire
            position={[0, lift * 0.55, lift * 0.45]}
            rotation={[lift * 0.5, frame * 0.01, 0]}
            emissive={C.heat}
            emissiveIntensity={tireHeat}
          />
        )}
        <Steam frame={frame} />
      </ThreeCanvas>
      <Scrims />
      <StepHeader
        step={5}
        title="Vulcanizado"
        subtitle="Calor y presión en el molde: el caucho cura y se graba el dibujo."
      />
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          padding: "0 84px 250px",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            opacity: interpolate(
              frame,
              [38, 46, 112, 120],
              [0, 1, 1, 0],
              clamp,
            ),
          }}
        >
          <div>
            <div
              style={{
                fontFamily: bodyFont,
                fontWeight: 600,
                fontSize: 36,
                color: C.muted,
              }}
            >
              Temperatura
            </div>
            <div
              style={{
                fontFamily: displayFont,
                fontWeight: 800,
                fontSize: 150,
                lineHeight: 1,
                color: temp > 140 ? C.accent : C.ink,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              ≈{temp}°C
            </div>
          </div>
          <Chip from={56}>Calor + presión</Chip>
        </div>
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          paddingBottom: 250,
        }}
      >
        <Chip from={124}>Dibujo y marcaje grabados</Chip>
      </AbsoluteFill>
      <Progress step={5} />
    </AbsoluteFill>
  );
};
