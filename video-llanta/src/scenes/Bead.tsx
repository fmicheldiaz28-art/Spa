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
import { Env, Rig, wrapRange } from "../components/three-helpers";
import { C } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const R = 0.95; // radio del aro
const WIRE = 0.021;
const D = 0.046;
// Haz hexagonal 3-4-5-4-3 = 19 vueltas
const TURNS: { r: number; z: number }[] = [];
[3, 4, 5, 4, 3].forEach((count, row) => {
  for (let i = 0; i < count; i++) {
    TURNS.push({ r: R + (row - 2) * D * 0.866, z: (i - (count - 1) / 2) * D });
  }
});

const WIND_START = 6;
const WIND_END = 68;
const APEX_SEGMENTS = 128;

export const Bead: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const turnF = interpolate(frame, [WIND_START, WIND_END], [0, TURNS.length], {
    ...clamp,
    easing: Easing.inOut(Easing.sin),
  });
  const done = Math.floor(turnF);
  const frac = turnF - done;
  const fullGeos = useMemo(
    () => TURNS.map((t) => new THREE.TorusGeometry(t.r, WIRE, 8, 180)),
    [],
  );
  const partial =
    done < TURNS.length && frac > 0.001
      ? new THREE.TorusGeometry(
          TURNS[done].r,
          WIRE,
          8,
          Math.max(3, Math.round(180 * frac)),
          frac * Math.PI * 2,
        )
      : null;

  // Relleno (ápex): perfil triangular que se enrolla después
  const apexProgress = interpolate(frame, [70, 96], [0, 1], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const apexGeo = useMemo(() => {
    const pts = [
      new THREE.Vector2(R + 0.12, -0.11),
      new THREE.Vector2(R + 0.34, -0.012),
      new THREE.Vector2(R + 0.34, 0.012),
      new THREE.Vector2(R + 0.12, 0.11),
      new THREE.Vector2(R + 0.12, -0.11),
    ];
    return new THREE.LatheGeometry(pts, APEX_SEGMENTS);
  }, []);
  wrapRange(apexGeo, APEX_SEGMENTS, apexProgress);

  // El aro gira para que el punto de alimentación quede fijo arriba
  const spin = Math.PI / 2 - turnF * Math.PI * 2 - apexProgress * Math.PI * 2;
  const current = TURNS[Math.min(done, TURNS.length - 1)];
  const feeding = frame >= WIND_START && turnF < TURNS.length;
  const feed = new THREE.Vector3(0, current.r, current.z);
  const spoolPos = new THREE.Vector3(-2.6, current.r + 0.25, 0);
  const wireLen = feed.distanceTo(spoolPos);
  const wireMid = feed.clone().add(spoolPos).multiplyScalar(0.5);
  const wireQuat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    spoolPos.clone().sub(feed).normalize(),
  );
  const tilt = interpolate(frame, [0, 105], [0.95, 0.75]);
  const bronze = { color: C.bronze, metalness: 0.9, roughness: 0.32 };

  return (
    <AbsoluteFill>
      <Backdrop glow="rgba(185,135,74,0.14)" y="58%" />
      <ThreeCanvas width={width} height={height}>
        <Env intensity={0.8} />
        <Rig
          position={[0.4, 0.2, 5.3]}
          target={[0, -0.25, 0]}
          fov={40}
          shiftY={0.08}
        />
        <ambientLight intensity={0.2} />
        <directionalLight position={[2, 4, 5]} intensity={2.6} />
        <pointLight
          position={[-2, 1, 2]}
          intensity={8}
          color="#ffcf8a"
          distance={7}
        />
        <group rotation={[-tilt, 0.25, 0]}>
          <group rotation={[0, 0, spin]}>
            {fullGeos.slice(0, done).map((g, i) => (
              <mesh key={i} geometry={g} position={[0, 0, TURNS[i].z]}>
                <meshStandardMaterial {...bronze} />
              </mesh>
            ))}
            {partial ? (
              <mesh geometry={partial} position={[0, 0, current.z]}>
                <meshStandardMaterial {...bronze} />
              </mesh>
            ) : null}
            {apexProgress > 0 ? (
              <mesh geometry={apexGeo} rotation={[Math.PI / 2, 0, 0]}>
                <meshStandardMaterial
                  color="#2b2b2d"
                  roughness={0.75}
                  side={THREE.DoubleSide}
                />
              </mesh>
            ) : null}
            {/* formador (rueda guía) */}
            <mesh>
              <torusGeometry args={[R - 0.16, 0.05, 12, 96]} />
              <meshStandardMaterial
                color="#59616b"
                metalness={0.8}
                roughness={0.35}
              />
            </mesh>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <mesh
                key={i}
                rotation={[0, 0, (i * Math.PI) / 3]}
                position={[0, 0, 0]}
              >
                <boxGeometry args={[0.04, (R - 0.16) * 2, 0.04]} />
                <meshStandardMaterial
                  color="#59616b"
                  metalness={0.8}
                  roughness={0.35}
                />
              </mesh>
            ))}
          </group>
          {feeding ? (
            <mesh position={wireMid} quaternion={wireQuat}>
              <cylinderGeometry args={[WIRE, WIRE, wireLen, 6]} />
              <meshStandardMaterial {...bronze} />
            </mesh>
          ) : null}
          <mesh
            position={[-2.6, current.r + 0.25 + 0.0, -0.0]}
            rotation={[0, 0, frame * 0.4]}
          >
            <cylinderGeometry args={[0.32, 0.32, 0.3, 32]} />
            <meshStandardMaterial {...bronze} roughness={0.5} />
          </mesh>
        </group>
      </ThreeCanvas>
      <Scrims />
      <StepHeader
        step={3}
        title="Talón"
        subtitle="Alambre de acero bronceado se enrolla en aros: anclan la llanta al rin."
      />
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          paddingBottom: 250,
        }}
      >
        <div style={{ display: "flex", gap: 20 }}>
          <Chip from={18} color={C.bronze}>
            {Math.min(TURNS.length, Math.ceil(turnF))} vueltas
          </Chip>
          <Chip from={72}>Relleno (ápex)</Chip>
        </div>
      </AbsoluteFill>
      <Progress step={3} />
    </AbsoluteFill>
  );
};
