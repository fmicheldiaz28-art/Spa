import * as THREE from "three";
import { outerProfile } from "./tire";

const W = 4096;
const H = 1024;

type Band = { v0: number; v1: number };

const findBands = () => {
  const { points, length } = outerProfile(140);
  const n = points.length;
  const v = (j: number) => j / (n - 1);
  const tread = points
    .map((p, j) => ({ p, j }))
    .filter(({ p }) => p.x >= 0.955)
    .map(({ j }) => j);
  const side = (sign: number): Band => {
    const idx = points
      .map((p, j) => ({ p, j }))
      .filter(({ p }) => Math.sign(p.y) === sign && p.x > 0.69 && p.x < 0.88)
      .map(({ j }) => j);
    return { v0: v(Math.min(...idx)), v1: v(Math.max(...idx)) };
  };
  return {
    length,
    tread: { v0: v(Math.min(...tread)), v1: v(Math.max(...tread)) },
    sidePos: side(1),
    sideNeg: side(-1),
  };
};

const SIDE_TEXT = "RADIAL  ·  295/80 R22.5  ·  TUBELESS  ·  STEEL BELTED  ·  ";

/**
 * Dibuja el dibujo de la banda (rib de camión: 4 surcos en zigzag + laminillas)
 * y el marcaje del costado sobre dos lienzos: color y relieve.
 */
const paint = (ctx: CanvasRenderingContext2D, mode: "color" | "bump") => {
  const bands = findBands();
  const base = mode === "color" ? "#1c1c1d" : "#808080";
  const groove = mode === "color" ? "#060606" : "#000000";
  const raised = mode === "color" ? "#5c5c60" : "#ffffff";
  const ring = mode === "color" ? "#2a2a2c" : "#b4b4b4";
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // --- Banda de rodadura ---
  const ty0 = bands.tread.v0 * H;
  const ty1 = bands.tread.v1 * H;
  const th = ty1 - ty0;
  if (mode === "color") {
    ctx.fillStyle = "#212123";
    ctx.fillRect(0, ty0 - th * 0.08, W, th * 1.16);
  }
  const period = 64;
  ctx.strokeStyle = groove;
  ctx.lineJoin = "miter";
  // Surcos circunferenciales en zigzag
  [0.21, 0.4, 0.6, 0.79].forEach((f, k) => {
    ctx.lineWidth = th * 0.055;
    ctx.beginPath();
    const amp = th * 0.025 * (k % 2 === 0 ? 1 : -1);
    for (let x = -period; x <= W + period; x += period / 2) {
      const y =
        ty0 + th * f + (Math.round(x / (period / 2)) % 2 === 0 ? amp : -amp);
      if (x === -period) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
  // Ranuras laterales del hombro
  ctx.fillStyle = groove;
  for (let x = 0; x < W; x += period) {
    ctx.fillRect(x, ty0 - th * 0.1, 16, th * 0.2);
    ctx.fillRect(x + period / 2, ty1 - th * 0.1, 16, th * 0.2);
  }
  // Laminillas (sipes) en los nervios centrales
  ctx.lineWidth = 3;
  for (let x = 0; x < W; x += period / 2) {
    [0.3, 0.5, 0.7].forEach((f) => {
      ctx.beginPath();
      ctx.moveTo(x, ty0 + th * (f - 0.05));
      ctx.lineTo(x + 10, ty0 + th * (f + 0.05));
      ctx.stroke();
    });
  }

  // --- Costados: anillos y texto en relieve ---
  const pxU = (r: number) => W / (2 * Math.PI * r);
  const pxV = H / bands.length;
  const drawSide = (b: Band, mirror: boolean) => {
    const y0 = b.v0 * H;
    const y1 = b.v1 * H;
    const h = y1 - y0;
    ctx.fillStyle = ring;
    ctx.fillRect(0, y0 - 6, W, 3);
    ctx.fillRect(0, y1 + 3, W, 3);
    const rMid = 0.79;
    const squash = pxV / pxU(rMid); // corrige la relación de aspecto del UV
    const fontPx = (h * 0.62) / squash;
    ctx.save();
    ctx.fillStyle = raised;
    ctx.font = `800 ${fontPx}px "DejaVu Sans", "Arial Black", sans-serif`;
    ctx.textBaseline = "middle";
    ctx.translate(0, (y0 + y1) / 2);
    ctx.scale(mirror ? -1 : 1, squash);
    const text = SIDE_TEXT + SIDE_TEXT;
    const tw = ctx.measureText(SIDE_TEXT).width;
    const sx = W / (tw * 2); // ajusta para que dos repeticiones llenen la vuelta
    ctx.scale(sx, 1);
    ctx.fillText(text, mirror ? -W / sx : 0, 0);
    ctx.restore();
  };
  drawSide(bands.sidePos, true);
  drawSide(bands.sideNeg, false);
};

const make = (mode: "color" | "bump") => {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D no disponible");
  paint(ctx, mode);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  if (mode === "color") tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

let cache: { map: THREE.Texture; bump: THREE.Texture } | null = null;
export const getTireTextures = () => {
  if (!cache) cache = { map: make("color"), bump: make("bump") };
  return cache;
};

/** Textura de cables: líneas paralelas (ángulo en grados respecto a la dirección v). */
export const makeCordTexture = (
  angleDeg: number,
  base = "#5c6670",
  line = "#d5dde5",
  spacing = 10,
) => {
  const S = 512;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = line;
  ctx.lineWidth = spacing * 0.35;
  ctx.save();
  ctx.translate(S / 2, S / 2);
  ctx.rotate((angleDeg * Math.PI) / 180);
  for (let x = -S; x <= S; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x, -S);
    ctx.lineTo(x, S);
    ctx.stroke();
  }
  ctx.restore();
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
};
