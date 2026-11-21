import { useMemo } from "react";
import * as THREE from "three";
import { makeInnerGeometry, makeOuterGeometry } from "../lib/tire";
import { getTireTextures } from "../lib/textures";

type MeshProps = React.ComponentProps<"group">;

/** Llanta terminada: dibujo de banda y marcaje en el costado. */
export const FinishedTire: React.FC<
  MeshProps & {
    emissive?: string;
    emissiveIntensity?: number;
    opacity?: number;
    shadows?: boolean;
  }
> = ({
  emissive = "#000000",
  emissiveIntensity = 0,
  opacity = 1,
  shadows = false,
  ...props
}) => {
  const outer = useMemo(() => makeOuterGeometry(256), []);
  const inner = useMemo(() => makeInnerGeometry(128), []);
  const { map, bump } = getTireTextures();
  return (
    <group {...props}>
      <mesh geometry={outer} castShadow={shadows} receiveShadow={shadows}>
        <meshStandardMaterial
          map={map}
          bumpMap={bump}
          bumpScale={4}
          roughness={0.82}
          metalness={0}
          emissive={emissive}
          emissiveIntensity={emissiveIntensity}
          transparent={opacity < 1}
          opacity={opacity}
        />
      </mesh>
      <mesh geometry={inner} castShadow={shadows} receiveShadow={shadows}>
        <meshStandardMaterial
          color="#141415"
          roughness={0.9}
          side={THREE.DoubleSide}
          transparent={opacity < 1}
          opacity={opacity}
        />
      </mesh>
    </group>
  );
};

/** Llanta verde (sin vulcanizar): misma forma, sin dibujo, tono gris mate. */
export const GreenTire: React.FC<
  MeshProps & { emissive?: string; emissiveIntensity?: number }
> = ({ emissive = "#000000", emissiveIntensity = 0, ...props }) => {
  const outer = useMemo(() => makeOuterGeometry(160), []);
  const inner = useMemo(() => makeInnerGeometry(96), []);
  return (
    <group {...props}>
      <mesh geometry={outer}>
        <meshStandardMaterial
          color="#3a3b3d"
          roughness={0.95}
          emissive={emissive}
          emissiveIntensity={emissiveIntensity}
        />
      </mesh>
      <mesh geometry={inner}>
        <meshStandardMaterial
          color="#2a2a2b"
          roughness={0.95}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
};
