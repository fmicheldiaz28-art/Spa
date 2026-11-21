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
import {
  Backdrop,
  Chip,
  Progress,
  Scrims,
  StepHeader,
} from "../components/Overlay";
import { Env, Rig } from "../components/three-helpers";
import mixing from "../data/mixing.json";
import { C, bodyFont } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

type Track = (number[] | null)[];
const KIND_COLOR: Record<string, string> = {
  caucho: C.natural,
  negro: "#101010",
  silice: C.silica,
  azufre: C.sulfur,
};

const steel = { color: "#59616b", metalness: 0.75, roughness: 0.38 };

const hazardTexture = () => {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#151515";
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = "#f2b81d";
  for (let x = -64; x < 320; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.lineTo(x + 24, 64);
    ctx.lineTo(x + 56, 0);
    ctx.lineTo(x + 32, 0);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

/** Rotor de la Banbury: perfil de dos lóbulos extruido. */
const useRotorGeometry = () =>
  useMemo(() => {
    const shape = new THREE.Shape();
    const N = 48;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = 0.15 + 0.08 * Math.pow(Math.abs(Math.cos(a)), 3);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 0.84,
      bevelEnabled: false,
      steps: 1,
    });
    g.translate(0, 0, -0.42);
    return g;
  }, []);

const Compound: React.FC<{ frame: number }> = ({ frame }) => {
  const base = useMemo(() => new THREE.IcosahedronGeometry(1, 4), []);
  const geo = useMemo(() => base.clone(), [base]);
  const src = base.getAttribute("position") as THREE.BufferAttribute;
  const dst = geo.getAttribute("position") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < src.count; i++) {
    v.fromBufferAttribute(src, i);
    const n =
      1 +
      0.13 *
        Math.sin(v.x * 4 + frame * 0.35) *
        Math.cos(v.y * 3 - frame * 0.25) +
      0.07 * Math.sin(v.z * 6 + frame * 0.5);
    dst.setXYZ(i, v.x * n * 1.35, v.y * n * 0.75, v.z * n);
  }
  dst.needsUpdate = true;
  geo.computeVertexNormals();
  const grow = interpolate(frame, [70, 90], [0, 0.4], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const out = interpolate(frame, [96, 112], [1, 0], {
    ...clamp,
    easing: Easing.in(Easing.cubic),
  });
  const s = grow * out;
  return (
    <mesh
      geometry={geo}
      position={[0, 0.78, 0]}
      scale={[s, s, s]}
      rotation={[0, frame * 0.05, 0]}
    >
      <meshStandardMaterial color="#0d0d0e" roughness={0.35} metalness={0.1} />
    </mesh>
  );
};

export const Mixing: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const rotor = useRotorGeometry();
  const hazard = useMemo(hazardTexture, []);
  const geos = useMemo(
    () => ({
      box: new THREE.BoxGeometry(2, 1.6, 2.2),
      ball: new THREE.SphereGeometry(1, 16, 12),
    }),
    [],
  );
  const items = mixing.items as { kind: string; size: number; track: Track }[];
  const rotorSpeed = interpolate(
    frame,
    [0, 60, 75, 100],
    [0.04, 0.06, 0.32, 0.32],
    clamp,
  );
  // Ángulo integrado para que la aceleración sea suave
  const rotorAngle =
    frame * 0.05 + Math.max(0, frame - 60) * (rotorSpeed - 0.05) * 0.6;
  const ramY = interpolate(frame, [52, 70, 100, 118], [4.9, 2.55, 2.55, 4.9], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const door = interpolate(frame, [90, 100], [0, 1.1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const sheetLen = interpolate(frame, [96, 125], [0, 3.2], clamp);
  const camX = interpolate(frame, [0, 125], [2.9, 2.2]);

  return (
    <AbsoluteFill>
      <Backdrop glow="rgba(120,160,200,0.12)" y="55%" />
      <ThreeCanvas width={width} height={height}>
        <Env intensity={0.6} />
        <Rig
          position={[camX, 1.9, 7.4]}
          target={[0, 0.95, 0]}
          fov={40}
          shiftY={0.1}
        />
        <ambientLight intensity={0.25} />
        <directionalLight position={[4, 6, 5]} intensity={2.2} />
        <pointLight
          position={[0, 1.1, 1.4]}
          intensity={4}
          color="#ffd9a8"
          distance={4}
        />

        {/* Ingredientes (física precalculada con Rapier) */}
        {items.map((it, i) => {
          const tr = it.track[frame];
          if (!tr) return null;
          const shrink = interpolate(
            frame,
            [70 + (i % 12), 86 + (i % 12)],
            [1, 0],
            clamp,
          );
          if (shrink <= 0.001) return null;
          const isBox = it.kind === "caucho";
          const s = it.size * shrink;
          return (
            <mesh
              key={i}
              geometry={isBox ? geos.box : geos.ball}
              position={[tr[0], tr[1], tr[2]]}
              quaternion={[tr[3], tr[4], tr[5], tr[6]]}
              scale={isBox ? [s, s, s] : [s, s, s]}
            >
              <meshStandardMaterial
                color={KIND_COLOR[it.kind]}
                roughness={it.kind === "negro" ? 0.6 : 0.5}
                metalness={0}
              />
            </mesh>
          );
        })}

        {/* Tolva */}
        <mesh position={[0, 2.175, 0]}>
          <cylinderGeometry args={[0.95, 0.34, 0.85, 40, 1, true]} />
          <meshStandardMaterial {...steel} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 2.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.95, 0.025, 8, 64]} />
          <meshStandardMaterial {...steel} />
        </mesh>
        {/* Pistón (ram) */}
        <group position={[0, ramY, 0]}>
          <mesh>
            <boxGeometry args={[0.6, 0.35, 0.6]} />
            <meshStandardMaterial
              color="#c9cdd2"
              metalness={0.8}
              roughness={0.25}
            />
          </mesh>
          <mesh position={[0, 1.6, 0]}>
            <cylinderGeometry args={[0.08, 0.08, 3, 16]} />
            <meshStandardMaterial
              color="#d9dde2"
              metalness={0.9}
              roughness={0.2}
            />
          </mesh>
        </group>

        {/* Cuerpo de la cámara de mezcla */}
        <group>
          <mesh position={[0, 0.9, -0.56]}>
            <boxGeometry args={[1.8, 1.9, 0.1]} />
            <meshStandardMaterial {...steel} color="#3a4048" />
          </mesh>
          {[-0.86, 0.86].map((x) => (
            <mesh key={x} position={[x, 0.9, 0]}>
              <boxGeometry args={[0.1, 1.9, 1.22]} />
              <meshStandardMaterial {...steel} color="#3a4048" />
            </mesh>
          ))}
          <mesh position={[0, -0.12, 0]}>
            <boxGeometry args={[1.82, 0.16, 1.22]} />
            <meshStandardMaterial map={hazard} roughness={0.6} />
          </mesh>
          {/* tapa con hueco */}
          <mesh position={[-0.6, 1.88, 0]}>
            <boxGeometry args={[0.62, 0.08, 1.22]} />
            <meshStandardMaterial {...steel} color="#3a4048" />
          </mesh>
          <mesh position={[0.6, 1.88, 0]}>
            <boxGeometry args={[0.62, 0.08, 1.22]} />
            <meshStandardMaterial {...steel} color="#3a4048" />
          </mesh>
          {/* ventana de vidrio frontal con marco */}
          <mesh position={[0, 0.9, 0.58]}>
            <boxGeometry args={[1.62, 1.9, 0.02]} />
            <meshPhysicalMaterial
              color="#bfe6ff"
              transparent
              opacity={0.12}
              roughness={0.05}
              metalness={0}
              depthWrite={false}
            />
          </mesh>
          {[
            [0, 1.86, 1.8, 0.08],
            [0, -0.02, 1.8, 0.08],
            [-0.84, 0.92, 0.08, 1.9],
            [0.84, 0.92, 0.08, 1.9],
          ].map(([x, y, w, h], i) => (
            <mesh key={i} position={[x, y, 0.6]}>
              <boxGeometry args={[w, h, 0.06]} />
              <meshStandardMaterial
                color="#f2b81d"
                metalness={0.3}
                roughness={0.5}
              />
            </mesh>
          ))}
          {/* Rotores contrarrotantes */}
          <mesh
            geometry={rotor}
            position={[-0.38, 0.3, 0]}
            rotation={[0, 0, rotorAngle]}
          >
            <meshStandardMaterial
              color="#9aa3ad"
              metalness={0.9}
              roughness={0.25}
            />
          </mesh>
          <mesh
            geometry={rotor}
            position={[0.38, 0.3, 0]}
            rotation={[0, 0, -rotorAngle + 0.8]}
          >
            <meshStandardMaterial
              color="#9aa3ad"
              metalness={0.9}
              roughness={0.25}
            />
          </mesh>
        </group>

        <Compound frame={frame} />

        {/* Compuerta de descarga y lámina de compuesto */}
        <mesh position={[0, -0.22, 0.45]} rotation={[-door, 0, 0]}>
          <boxGeometry args={[1.1, 0.04, 0.5]} />
          <meshStandardMaterial {...steel} />
        </mesh>
        {sheetLen > 0.01 ? (
          <mesh position={[0, -0.32, 0.2 + sheetLen / 2]}>
            <boxGeometry args={[1.0, 0.06, sheetLen]} />
            <meshStandardMaterial color="#0f0f10" roughness={0.45} />
          </mesh>
        ) : null}
        {/* Transportador */}
        {Array.from({ length: 9 }, (_, i) => (
          <mesh
            key={i}
            position={[0, -0.4, 0.35 + i * 0.36]}
            rotation={[frame * 0.2, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[0.05, 0.05, 1.2, 12]} />
            <meshStandardMaterial {...steel} color="#8b939c" />
          </mesh>
        ))}
      </ThreeCanvas>
      <Scrims />
      <StepHeader
        step={1}
        title="Mezclado"
        subtitle="Caucho, negro de humo, sílice y azufre se amasan en una mezcladora Banbury."
      />
      <Legend frame={frame} />
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          paddingBottom: 250,
        }}
      >
        <Chip from={92}>Compuesto homogéneo</Chip>
      </AbsoluteFill>
      <Progress step={1} />
    </AbsoluteFill>
  );
};

const Legend: React.FC<{ frame: number }> = ({ frame }) => {
  const rows: [string, string][] = [
    ["Caucho natural", C.natural],
    ["Negro de humo", "#3a3a3a"],
    ["Sílice", C.silica],
    ["Azufre", C.sulfur],
  ];
  const out = interpolate(frame, [80, 90], [1, 0], clamp);
  return (
    <AbsoluteFill
      style={{ justifyContent: "flex-end", padding: "0 84px 250px" }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "18px 40px",
          opacity: out,
          padding: "26px 30px",
          borderRadius: 24,
          background: "rgba(10,12,15,0.82)",
          border: "1px solid rgba(255,255,255,0.12)",
        }}
      >
        {rows.map(([name, color], i) => (
          <div
            key={name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              width: 380,
              fontFamily: bodyFont,
              fontWeight: 600,
              fontSize: 42,
              color: C.ink,
              opacity: interpolate(
                frame,
                [12 + i * 8, 22 + i * 8],
                [0, 1],
                clamp,
              ),
              translate: interpolate(
                frame,
                [12 + i * 8, 22 + i * 8],
                ["0px 20px", "0px 0px"],
                clamp,
              ),
            }}
          >
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                background: color,
                border: "2px solid rgba(255,255,255,0.5)",
              }}
            />
            {name}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
