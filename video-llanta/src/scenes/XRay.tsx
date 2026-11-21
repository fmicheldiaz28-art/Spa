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
import { Backdrop, Progress, Scrims, StepHeader } from "../components/Overlay";
import { Env, LocalClipping, Rig } from "../components/three-helpers";
import { FinishedTire } from "../components/Tires";
import { TIRE, cordProfile, makeOuterGeometry } from "../lib/tire";
import { C, bodyFont, displayFont } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const BAND = 0.6;

/** Geometría de líneas: carcasa radial, 4 cinturones cruzados y talones. */
const useCordLines = () =>
  useMemo(() => {
    const pos: number[] = [];
    const seg = (a: THREE.Vector3, b: THREE.Vector3) =>
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const at = (r: number, y: number, th: number) =>
      new THREE.Vector3(r * Math.sin(th), y, r * Math.cos(th));
    // Carcasa radial: cables de talón a talón siguiendo el perfil
    const prof = cordProfile(36);
    const N = 110;
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2;
      for (let j = 0; j < prof.length - 1; j++) {
        seg(at(prof[j].x, prof[j].y, th), at(prof[j + 1].x, prof[j + 1].y, th));
      }
    }
    // Cinturones: hélices cortas a ±20°
    [0.2, 0.23, 0.2, 0.15].forEach((hw, k) => {
      const r = 0.955 + k * 0.006;
      const dir = k % 2 === 0 ? 1 : -1;
      const M = 140;
      for (let i = 0; i < M; i++) {
        const th0 = (i / M) * Math.PI * 2;
        const dth = (dir * (2 * hw) * Math.tan((20 * Math.PI) / 180)) / r;
        const steps = 5;
        for (let s = 0; s < steps; s++) {
          const t0 = s / steps;
          const t1 = (s + 1) / steps;
          seg(
            at(r, -hw + 2 * hw * t0, th0 + dth * t0),
            at(r, -hw + 2 * hw * t1, th0 + dth * t1),
          );
        }
      }
    });
    // Talones: varios anillos
    [-1, 1].forEach((side) => {
      for (let k = 0; k < 4; k++) {
        const r = TIRE.rc - TIRE.ar * 0.86 + (k % 2) * 0.012;
        const y = side * (0.205 + Math.floor(k / 2) * 0.012);
        const M = 160;
        for (let i = 0; i < M; i++) {
          seg(
            at(r, y, (i / M) * Math.PI * 2),
            at(r, y, ((i + 1) / M) * Math.PI * 2),
          );
        }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, []);

export const XRay: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const lines = useCordLines();
  const ghost = useMemo(() => makeOuterGeometry(128), []);
  const scanX = interpolate(frame, [8, 84], [-1.7, 1.7], {
    ...clamp,
    easing: Easing.inOut(Easing.sin),
  });
  const a = scanX - BAND / 2;
  const b = scanX + BAND / 2;

  const planes = useMemo(
    () => ({
      inA: new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),
      inB: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
      outA: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
      outB: new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),
    }),
    [],
  );
  planes.inA.constant = -a; // x ≥ a
  planes.inB.constant = b; // x ≤ b
  planes.outA.constant = a; // x ≤ a
  planes.outB.constant = -b; // x ≥ b

  const xrayMats = useMemo(
    () => ({
      ghost: new THREE.MeshBasicMaterial({
        color: "#1b6fa8",
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      lines: new THREE.LineBasicMaterial({
        color: "#8be9ff",
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    }),
    [],
  );
  xrayMats.ghost.clippingPlanes = [planes.inA, planes.inB];
  xrayMats.lines.clippingPlanes = [planes.inA, planes.inB];

  const tireRot: [number, number, number] = [
    Math.PI / 2,
    0,
    -0.42 + frame * 0.004,
  ];
  const spinAxis = frame * 0.012;
  const checks = [
    { at: 34, label: "Rayos X: estructura de acero" },
    { at: 52, label: "Uniformidad y geometría" },
    { at: 70, label: "Balanceo" },
  ];
  const stamp = interpolate(frame, [84, 92], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.back(2)),
  });

  return (
    <AbsoluteFill>
      <Backdrop glow="rgba(95,225,255,0.16)" y="50%" />
      <ThreeCanvas width={width} height={height}>
        <LocalClipping />
        <Env intensity={0.7} />
        <Rig
          position={[0, 0.1, 6.3]}
          target={[0, -0.25, 0]}
          fov={38}
          shiftY={0.04}
        />
        <ambientLight intensity={0.25} />
        <directionalLight position={[-3, 3, 5]} intensity={2.4} />
        <pointLight
          position={[2, -1, 2]}
          intensity={5}
          color={C.cyan}
          distance={6}
        />
        <group rotation={tireRot}>
          <group rotation={[0, spinAxis, 0]}>
            <ClippedTire planes={[planes.outA, planes.outB]} />
            <mesh geometry={ghost} material={xrayMats.ghost} />
            <lineSegments geometry={lines} material={xrayMats.lines} />
          </group>
        </group>
        {/* bordes del haz */}
        {[a, b].map((x, i) => (
          <mesh key={i} position={[x, 0, 0.2]}>
            <boxGeometry args={[0.012, 2.3, 0.012]} />
            <meshBasicMaterial
              color={C.cyan}
              transparent
              opacity={frame > 8 && frame < 86 ? 0.9 : 0}
            />
          </mesh>
        ))}
      </ThreeCanvas>
      <Scrims />
      <StepHeader
        step={6}
        title="Inspección"
        subtitle="Cada llanta de camión pasa por rayos X y pruebas finales."
      />
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          padding: "0 84px 250px",
          pointerEvents: "none",
        }}
      >
        {checks.map((c) => (
          <div
            key={c.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              fontFamily: bodyFont,
              fontWeight: 600,
              fontSize: 44,
              color: C.ink,
              marginTop: 18,
              opacity: interpolate(frame, [c.at, c.at + 8], [0, 1], clamp),
              translate: interpolate(
                frame,
                [c.at, c.at + 8],
                ["30px 0px", "0px 0px"],
                clamp,
              ),
            }}
          >
            <span
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                background: "#2fd07a",
                color: "#06210f",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 34,
                fontWeight: 800,
              }}
            >
              ✓
            </span>
            {c.label}
          </div>
        ))}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            marginTop: 160,
            fontFamily: displayFont,
            fontWeight: 800,
            fontSize: 120,
            letterSpacing: 6,
            color: "#2fd07a",
            border: "10px solid #2fd07a",
            borderRadius: 18,
            padding: "6px 34px",
            rotate: "-8deg",
            background: "rgba(5,20,12,0.55)",
            opacity: stamp,
            scale: interpolate(stamp, [0, 1], [1.6, 1]),
          }}
        >
          APROBADA
        </div>
      </AbsoluteFill>
      <Progress step={6} />
    </AbsoluteFill>
  );
};

/** Llanta normal recortada fuera del haz de rayos X. */
const ClippedTire: React.FC<{ planes: THREE.Plane[] }> = ({ planes }) => (
  <group
    ref={(g) => {
      if (!g) return;
      g.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m) {
          m.clippingPlanes = planes;
          m.clipIntersection = true;
        }
      });
    }}
  >
    <FinishedTire />
  </group>
);
