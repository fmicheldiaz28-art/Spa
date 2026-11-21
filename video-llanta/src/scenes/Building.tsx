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
import {
  TIRE,
  bandProfile,
  innerProfile,
  lerpProfiles,
  outerProfile,
  resample,
} from "../lib/tire";
import { makeCordTexture } from "../lib/textures";
import { C } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const inOut = Easing.inOut(Easing.cubic);
const SEG = 160;

const DRUM_R = 0.58;
const HALF = 0.62;
const CARCASS_AR = 0.17; // corona de la carcasa en r ≈ 0.945

/** Línea de tiempo de la construcción (fotogramas de la escena). */
const T = {
  liner: [12, 34],
  ply: [34, 56],
  beads: [56, 72],
  side: [68, 86],
  shape: [88, 118],
  belts: [118, 146],
  tread: [146, 166],
} as const;

const LAYERS = [
  { at: T.liner[0], label: "Inner liner hermético", color: "#4d6a85" },
  { at: T.ply[0], label: "Carcasa radial de acero", color: C.steel },
  { at: T.beads[0], label: "Talones", color: C.bronze },
  { at: T.side[0], label: "Costados", color: "#3b3b3e" },
  { at: T.shape[0], label: "Conformado", color: C.accent },
  { at: T.belts[0], label: "4 cinturones de acero", color: C.steel },
  { at: T.tread[0], label: "Banda de rodadura", color: "#2b2b2d" },
  { at: 168, label: "= Llanta verde", color: C.accent },
];

const lathe = (pts: THREE.Vector2[]) => new THREE.LatheGeometry(pts, SEG);

/** Perfiles cerrados con el mismo número de puntos para el conformado (cilindro → toroide). */
const useMorphProfiles = () =>
  useMemo(() => {
    const N = 90;
    const M = 70;
    const flatOuter: THREE.Vector2[] = [];
    const flatInner: THREE.Vector2[] = [];
    for (let i = 0; i < N; i++) {
      flatOuter.push(
        new THREE.Vector2(DRUM_R + 0.05, -HALF + (i / (N - 1)) * 2 * HALF),
      );
    }
    for (let i = 0; i < M; i++) {
      flatInner.push(
        new THREE.Vector2(DRUM_R + 0.005, HALF - (i / (M - 1)) * 2 * HALF),
      );
    }
    const tireOuter = outerProfile(N, CARCASS_AR).points;
    const tireInner = resample(innerProfile(M, CARCASS_AR).points, M).points;
    const a = [...flatOuter, ...flatInner, flatOuter[0]];
    const b = [...tireOuter, ...tireInner, tireOuter[0]];
    return { a, b };
  }, []);

export const Building: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const p = (r: readonly [number, number]) =>
    interpolate(frame, [r[0], r[1]], [0, 1], { ...clamp, easing: inOut });

  const tex = useMemo(() => {
    const ply = makeCordTexture(0, "#3c434b", "#d9e1ea", 16);
    ply.repeat.set(5, 1);
    const beltA = makeCordTexture(22, "#4d555e", "#dfe6ee", 12);
    beltA.repeat.set(8, 1);
    const beltB = makeCordTexture(-22, "#4d555e", "#dfe6ee", 12);
    beltB.repeat.set(8, 1);
    return { ply, beltA, beltB };
  }, []);

  const geos = useMemo(
    () => ({
      liner: lathe(bandProfile(DRUM_R, DRUM_R + 0.015, -HALF, HALF)),
      ply: lathe(
        bandProfile(DRUM_R + 0.015, DRUM_R + 0.03, -HALF + 0.02, HALF - 0.02),
      ),
      sideA: lathe(bandProfile(DRUM_R + 0.03, DRUM_R + 0.05, 0.28, HALF)),
      sideB: lathe(bandProfile(DRUM_R + 0.03, DRUM_R + 0.05, -HALF, -0.28)),
      belts: [0.2, 0.23, 0.205, 0.15].map((hw, k) =>
        lathe(bandProfile(0.94 + k * 0.009, 0.947 + k * 0.009, -hw, hw)),
      ),
      tread: lathe([
        new THREE.Vector2(0.935, -0.27),
        new THREE.Vector2(0.985, -0.262),
        new THREE.Vector2(1.0, -0.22),
        new THREE.Vector2(1.006, 0),
        new THREE.Vector2(1.0, 0.22),
        new THREE.Vector2(0.985, 0.262),
        new THREE.Vector2(0.935, 0.27),
        new THREE.Vector2(0.935, -0.27),
      ]),
    }),
    [],
  );

  const morph = useMorphProfiles();
  const shapeT = p(T.shape);
  const morphGeo = useMemo(
    () => (shapeT > 0 ? lathe(lerpProfiles(morph.a, morph.b, shapeT)) : null),
    [shapeT, morph],
  );

  wrapRange(geos.liner, SEG, p(T.liner));
  wrapRange(geos.ply, SEG, p(T.ply));
  wrapRange(geos.sideA, SEG, p(T.side));
  wrapRange(geos.sideB, SEG, p(T.side));
  geos.belts.forEach((g, k) =>
    wrapRange(
      g,
      SEG,
      interpolate(
        frame,
        [T.belts[0] + k * 6, T.belts[0] + k * 6 + 12],
        [0, 1],
        { ...clamp, easing: inOut },
      ),
    ),
  );
  wrapRange(geos.tread, SEG, p(T.tread));

  const beadIn = p(T.beads);
  const beadY = interpolate(beadIn, [0, 1], [1.7, HALF - 0.02]);
  // durante el conformado los talones se acercan (r constante en el aro)
  const beadEnd = Math.abs(outerProfile(90, CARCASS_AR).points[0].y);
  const beadYShaped = interpolate(shapeT, [0, 1], [beadY, beadEnd + 0.02]);
  const beadR = interpolate(
    shapeT,
    [0, 1],
    [DRUM_R + 0.06, TIRE.rc - CARCASS_AR * 0.9 + 0.01],
  );

  const spin = frame * 0.09;
  const orbit = interpolate(frame, [0, 180], [0.62, 1.05], {
    ...clamp,
    easing: Easing.inOut(Easing.sin),
  });
  const dist = interpolate(frame, [0, 90, 180], [4.4, 4.6, 5.4], clamp);
  const camPos: [number, number, number] = [
    Math.sin(orbit) * dist,
    1.2,
    Math.cos(orbit) * dist,
  ];

  const preShape = frame < T.shape[0];
  const current = [...LAYERS].reverse().find((l) => frame >= l.at);
  const layerIdx = current ? LAYERS.indexOf(current) : -1;

  return (
    <AbsoluteFill>
      <Backdrop glow="rgba(170,183,196,0.12)" y="56%" />
      <ThreeCanvas width={width} height={height}>
        <Env intensity={0.75} />
        <Rig position={camPos} target={[0, -0.05, 0]} fov={42} shiftY={0.07} />
        <ambientLight intensity={0.22} />
        <directionalLight position={[3, 5, 4]} intensity={2.4} />
        <pointLight
          position={[-2, 0.5, 2.5]}
          intensity={6}
          color="#ffd9a8"
          distance={7}
        />
        {/* eje del tambor horizontal (X) */}
        <group rotation={[0, 0, Math.PI / 2]}>
          {/* eje y cabezal */}
          <mesh position={[0, -1.5, 0]}>
            <cylinderGeometry args={[0.12, 0.12, 1.8, 24]} />
            <meshStandardMaterial
              color="#9aa2ab"
              metalness={0.9}
              roughness={0.25}
            />
          </mesh>
          <group rotation={[0, spin, 0]}>
            {/* tambor */}
            {preShape ? (
              <mesh>
                <cylinderGeometry args={[DRUM_R, DRUM_R, HALF * 2 + 0.1, 64]} />
                <meshStandardMaterial
                  color="#b9c0c8"
                  metalness={0.95}
                  roughness={0.2}
                />
              </mesh>
            ) : null}
            {preShape ? (
              <>
                <mesh geometry={geos.liner}>
                  <meshStandardMaterial
                    color="#2f3a44"
                    roughness={0.7}
                    side={THREE.DoubleSide}
                  />
                </mesh>
                <mesh geometry={geos.ply}>
                  <meshStandardMaterial
                    map={tex.ply}
                    metalness={0.5}
                    roughness={0.45}
                    side={THREE.DoubleSide}
                  />
                </mesh>
                <mesh geometry={geos.sideA}>
                  <meshStandardMaterial
                    color="#232325"
                    roughness={0.85}
                    side={THREE.DoubleSide}
                  />
                </mesh>
                <mesh geometry={geos.sideB}>
                  <meshStandardMaterial
                    color="#232325"
                    roughness={0.85}
                    side={THREE.DoubleSide}
                  />
                </mesh>
              </>
            ) : null}
            {morphGeo ? (
              <mesh geometry={morphGeo}>
                <meshStandardMaterial
                  color="#38393c"
                  roughness={0.88}
                  side={THREE.DoubleSide}
                />
              </mesh>
            ) : null}
            {/* talones */}
            {beadIn > 0
              ? [1, -1].map((s) => (
                  <mesh
                    key={s}
                    position={[0, s * beadYShaped, 0]}
                    rotation={[Math.PI / 2, 0, 0]}
                  >
                    <torusGeometry args={[beadR, 0.045, 12, 96]} />
                    <meshStandardMaterial
                      color={C.bronze}
                      metalness={0.9}
                      roughness={0.3}
                    />
                  </mesh>
                ))
              : null}
            {/* cinturones */}
            {frame >= T.belts[0]
              ? geos.belts.map((g, k) => (
                  <mesh key={k} geometry={g}>
                    <meshStandardMaterial
                      map={k % 2 === 0 ? tex.beltA : tex.beltB}
                      metalness={0.6}
                      roughness={0.4}
                      side={THREE.DoubleSide}
                    />
                  </mesh>
                ))
              : null}
            {frame >= T.tread[0] ? (
              <mesh geometry={geos.tread}>
                <meshStandardMaterial
                  color="#262628"
                  roughness={0.85}
                  side={THREE.DoubleSide}
                />
              </mesh>
            ) : null}
          </group>
        </group>
      </ThreeCanvas>
      <Scrims />
      <StepHeader
        step={4}
        title="Construcción"
        subtitle="Capa a capa sobre un tambor giratorio hasta formar la llanta verde."
      />
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          padding: "0 84px 250px",
          pointerEvents: "none",
        }}
      >
        {current ? (
          <div
            style={{ display: "flex", alignItems: "center", gap: 22 }}
            key={current.label}
          >
            <Chip from={current.at} color={current.color}>
              {layerIdx < 7 ? (
                <span style={{ color: C.accent, marginRight: 4 }}>
                  {layerIdx + 1}/7
                </span>
              ) : null}
              {current.label}
            </Chip>
          </div>
        ) : null}
      </AbsoluteFill>
      <Progress step={4} />
    </AbsoluteFill>
  );
};
