import * as THREE from "three";

/**
 * Perfil de sección de una llanta radial de camión (tipo 295/80 R22.5).
 * Unidades: 1 = radio exterior. Coordenadas del perfil: x = radio, y = eje axial
 * (LatheGeometry gira alrededor del eje Y).
 */
export const TIRE = {
  rc: 0.775, // radio del centro de la sección
  ar: 0.225, // semieje radial (corona en rc + ar = 1.0)
  ay: 0.29, // semieje axial (ancho de sección)
  n: 4, // exponente de superelipse (perfil "cuadrado" de camión)
  phi0: 0.62, // apertura en el talón
  thick: 0.055,
};

const sp = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);

export const superPoint = (
  phi: number,
  ar = TIRE.ar,
  ay = TIRE.ay,
  rc = TIRE.rc,
  n = TIRE.n,
) => {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return new THREE.Vector2(rc - ar * sp(c, 2 / n), ay * sp(s, 2 / n));
};

/** Re-muestrea una polilínea con espaciado uniforme por longitud de arco. */
export const resample = (pts: THREE.Vector2[], count: number) => {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  }
  const total = cum[cum.length - 1];
  const out: THREE.Vector2[] = [];
  let k = 1;
  for (let i = 0; i < count; i++) {
    const d = (i / (count - 1)) * total;
    while (k < cum.length - 1 && cum[k] < d) k++;
    const t = (d - cum[k - 1]) / Math.max(1e-9, cum[k] - cum[k - 1]);
    out.push(pts[k - 1].clone().lerp(pts[k], Math.min(1, Math.max(0, t))));
  }
  return { points: out, length: total };
};

/**
 * Perfil exterior, del talón -y al talón +y (este orden deja las normales hacia fuera
 * en LatheGeometry).
 */
export const outerProfile = (count = 140, ar = TIRE.ar, ay = TIRE.ay) => {
  const dense: THREE.Vector2[] = [];
  const N = 800;
  for (let i = 0; i <= N; i++) {
    const phi =
      Math.PI * 2 - TIRE.phi0 - (i / N) * (Math.PI * 2 - 2 * TIRE.phi0);
    dense.push(superPoint(phi, ar, ay));
  }
  return resample(dense, count);
};

export const innerProfile = (count = 90, ar = TIRE.ar, ay = TIRE.ay) => {
  const dense: THREE.Vector2[] = [];
  const N = 600;
  for (let i = 0; i <= N; i++) {
    const phi = TIRE.phi0 + (i / N) * (Math.PI * 2 - 2 * TIRE.phi0);
    dense.push(superPoint(phi, ar - TIRE.thick, ay - TIRE.thick));
  }
  return resample(dense, count);
};

/** Superficie exterior (con UV útiles para el dibujo de la banda y el costado). */
export const makeOuterGeometry = (
  segments = 256,
  ar = TIRE.ar,
  ay = TIRE.ay,
  phiLength = Math.PI * 2,
) => {
  const { points } = outerProfile(140, ar, ay);
  return new THREE.LatheGeometry(points, segments, 0, phiLength);
};

/** Interior + cierres del talón para que la pieza sea "sólida". */
export const makeInnerGeometry = (
  segments = 128,
  ar = TIRE.ar,
  ay = TIRE.ay,
) => {
  const outer = outerProfile(140, ar, ay).points;
  const inner = innerProfile(90, ar, ay).points;
  const pts = [outer[outer.length - 1], ...inner, outer[0]];
  return new THREE.LatheGeometry(pts, segments);
};

/** Puntos del perfil (para cables de rayos X), ligeramente hacia dentro. */
export const cordProfile = (count = 40) =>
  outerProfile(count, TIRE.ar - 0.03, TIRE.ay - 0.03).points;

/** Interpola dos perfiles con el mismo número de puntos. */
export const lerpProfiles = (
  a: THREE.Vector2[],
  b: THREE.Vector2[],
  t: number,
) => a.map((p, i) => p.clone().lerp(b[i], t));

/** Banda rectangular cerrada (para capas sobre el tambor). */
export const bandProfile = (r0: number, r1: number, y0: number, y1: number) => [
  new THREE.Vector2(r0, y0),
  new THREE.Vector2(r1, y0),
  new THREE.Vector2(r1, y1),
  new THREE.Vector2(r0, y1),
  new THREE.Vector2(r0, y0),
];

/** Pseudoaleatorio determinista. */
export const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
