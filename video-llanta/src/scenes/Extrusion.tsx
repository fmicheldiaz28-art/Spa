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
import { makeCordTexture } from "../lib/textures";
import { C } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const steel = { color: "#5b636d", metalness: 0.8, roughness: 0.35 };

/** Perfil de la banda de rodadura extruida (sección trapezoidal con alas). */
const useTreadStrip = () =>
  useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-0.34, 0);
    s.lineTo(0.34, 0);
    s.lineTo(0.3, 0.035);
    s.lineTo(0.24, 0.1);
    s.lineTo(-0.24, 0.1);
    s.lineTo(-0.3, 0.035);
    s.lineTo(-0.34, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
    return g; // va de z=0 a z=1; se escala en z
  }, []);

const UPPER_Y = 0.75;
const LOWER_Y = -1.35;

export const Extrusion: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const strip = useTreadStrip();
  const sheetTex = useMemo(() => {
    const t = makeCordTexture(0, "#121213", "#2c2d30", 16);
    t.repeat.set(10, 1);
    return t;
  }, []);
  const stripLen = interpolate(frame, [4, 110], [0, 4.2], clamp);
  const sheetLen = interpolate(frame, [20, 125], [0, 4.0], clamp);
  const roll = frame * 0.12;
  const camY = interpolate(frame, [0, 125], [1.0, 0.4], {
    ...clamp,
    easing: Easing.inOut(Easing.sin),
  });

  const cords = useMemo(
    () => Array.from({ length: 22 }, (_, i) => -0.63 + (i * 1.26) / 21),
    [],
  );

  return (
    <AbsoluteFill>
      <Backdrop glow="rgba(95,225,255,0.08)" y="62%" />
      <ThreeCanvas width={width} height={height}>
        <Env intensity={0.65} />
        <Rig
          position={[3.3, camY + 1.1, 5.6]}
          target={[0, -0.35, 0.3]}
          fov={44}
          shiftY={0.12}
        />
        <ambientLight intensity={0.25} />
        <directionalLight position={[3, 6, 4]} intensity={2.4} />
        <pointLight
          position={[-1.5, 1.5, 2]}
          intensity={6}
          color="#ffd2a1"
          distance={6}
        />

        {/* ---------- Extrusora (arriba) ---------- */}
        <group position={[0, UPPER_Y, 0]}>
          <mesh position={[0, 0.25, -2.4]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.32, 0.32, 3.2, 32]} />
            <meshStandardMaterial {...steel} />
          </mesh>
          {/* bandas calefactoras */}
          {[0, 1, 2, 3, 4].map((i) => (
            <mesh
              key={i}
              position={[0, 0.25, -3.6 + i * 0.6]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <cylinderGeometry args={[0.35, 0.35, 0.16, 32]} />
              <meshStandardMaterial
                color="#7a2a10"
                emissive={C.heat}
                emissiveIntensity={0.35 + 0.15 * Math.sin(frame * 0.2 + i)}
                metalness={0.4}
                roughness={0.5}
              />
            </mesh>
          ))}
          <mesh position={[0, 0.75, -3.3]}>
            <cylinderGeometry args={[0.32, 0.12, 0.6, 24, 1, true]} />
            <meshStandardMaterial {...steel} side={THREE.DoubleSide} />
          </mesh>
          {/* cabezal / boquilla */}
          <mesh position={[0, 0.2, -0.65]}>
            <boxGeometry args={[0.95, 0.6, 0.5]} />
            <meshStandardMaterial
              color="#f2b81d"
              metalness={0.4}
              roughness={0.45}
            />
          </mesh>
          {/* banda de rodadura saliendo */}
          {stripLen > 0.01 ? (
            <mesh
              geometry={strip}
              position={[0, 0.02, -0.4]}
              scale={[1, 1, stripLen]}
            >
              <meshStandardMaterial
                color="#141415"
                roughness={0.42}
                metalness={0.05}
              />
            </mesh>
          ) : null}
          {/* rodillos del transportador */}
          {Array.from({ length: 12 }, (_, i) => (
            <mesh
              key={i}
              position={[0, -0.04, -0.2 + i * 0.36]}
              rotation={[roll, 0, Math.PI / 2]}
            >
              <cylinderGeometry args={[0.04, 0.04, 0.9, 12]} />
              <meshStandardMaterial {...steel} color="#9aa2ab" />
            </mesh>
          ))}
          {[-0.47, 0.47].map((x) => (
            <mesh key={x} position={[x, -0.06, 1.8]}>
              <boxGeometry args={[0.04, 0.1, 4.2]} />
              <meshStandardMaterial {...steel} />
            </mesh>
          ))}
        </group>

        {/* ---------- Calandra (abajo) ---------- */}
        <group position={[0, LOWER_Y, 0]}>
          {/* rodillos */}
          {[
            [0.36, -0.05, 1],
            [-0.31, 0.0, -1],
            [0.62, -0.62, -1],
          ].map(([y, z, dir], i) => (
            <mesh
              key={i}
              position={[0, y, z]}
              rotation={[roll * dir, 0, Math.PI / 2]}
            >
              <cylinderGeometry args={[0.3, 0.3, 1.7, 48]} />
              <meshStandardMaterial
                color="#c3c9d0"
                metalness={0.95}
                roughness={0.15}
              />
            </mesh>
          ))}
          {/* bastidor */}
          {[-0.95, 0.95].map((x) => (
            <mesh key={x} position={[x, 0.2, -0.2]}>
              <boxGeometry args={[0.16, 1.7, 1.4]} />
              <meshStandardMaterial
                color="#3a4048"
                metalness={0.6}
                roughness={0.45}
              />
            </mesh>
          ))}
          {/* banco de caucho en la entrada */}
          <mesh position={[0, 0.2, -0.36]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.07, 0.07, 1.4, 16]} />
            <meshStandardMaterial color="#111" roughness={0.5} />
          </mesh>
          {/* cables de acero entrando */}
          {cords.map((x) => (
            <mesh
              key={x}
              position={[x, 0.03, -2.2]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <cylinderGeometry args={[0.012, 0.012, 4, 6]} />
              <meshStandardMaterial
                color="#e3e8ee"
                metalness={1}
                roughness={0.2}
              />
            </mesh>
          ))}
          {/* lámina calandrada saliendo */}
          {sheetLen > 0.01 ? (
            <mesh position={[0, 0.03, 0.05 + sheetLen / 2]}>
              <boxGeometry args={[1.32, 0.035, sheetLen]} />
              <meshStandardMaterial
                map={sheetTex}
                bumpMap={sheetTex}
                bumpScale={2}
                roughness={0.5}
              />
            </mesh>
          ) : null}
        </group>
      </ThreeCanvas>
      <Scrims />
      <StepHeader
        step={2}
        title="Extrusión y calandrado"
        subtitle="Se forman banda y costados; los cables de acero se recubren de caucho."
      />
      <AbsoluteFill style={{ padding: "0 84px", pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: 820, right: 84 }}>
          <Chip from={22}>Banda de rodadura</Chip>
        </div>
        <div style={{ position: "absolute", top: 1560, left: 84 }}>
          <Chip from={50} color={C.steel}>
            Acero + caucho
          </Chip>
        </div>
      </AbsoluteFill>
      <Progress step={2} />
    </AbsoluteFill>
  );
};
