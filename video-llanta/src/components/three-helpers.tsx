import { useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/** Iluminación de entorno procedural (sin descargas): reflejos creíbles en metal y caucho. */
export const Env: React.FC<{ intensity?: number }> = ({ intensity = 0.55 }) => {
  const { gl, scene } = useThree();
  useMemo(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const tex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = tex;
    pm.dispose();
  }, [gl, scene]);
  scene.environmentIntensity = intensity;
  return null;
};

type Vec3 = [number, number, number];

/** Cámara controlada por fotograma. shiftY desplaza el encuadre (fracción de alto). */
export const Rig: React.FC<{
  position: Vec3;
  target: Vec3;
  fov?: number;
  shiftY?: number;
}> = ({ position, target, fov = 40, shiftY = 0 }) => {
  const { camera, size } = useThree();
  useLayoutEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.position.set(...position);
    cam.fov = fov;
    cam.near = 0.05;
    cam.far = 100;
    cam.lookAt(...target);
    if (shiftY !== 0) {
      cam.setViewOffset(
        size.width,
        size.height,
        0,
        -shiftY * size.height,
        size.width,
        size.height,
      );
    } else {
      cam.clearViewOffset();
    }
    cam.updateProjectionMatrix();
  });
  return null;
};

/** Activa planos de recorte locales (para el escáner de rayos X). */
export const LocalClipping: React.FC = () => {
  const { gl } = useThree();
  gl.localClippingEnabled = true;
  return null;
};

/** Muestra una fracción (0-1) de una geometría Lathe, como si se enrollara. */
export const wrapRange = (
  geo: THREE.BufferGeometry,
  segments: number,
  progress: number,
) => {
  const index = geo.getIndex();
  if (!index) return;
  const perSeg = index.count / segments;
  const segs = Math.max(0, Math.min(segments, Math.round(progress * segments)));
  geo.setDrawRange(0, segs * perSeg);
};
