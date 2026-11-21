// Sintetiza la banda sonora (sin samples externos): pulso industrial a 120 BPM,
// transiciones, efectos por escena y golpes sincronizados con la física horneada.
import { readFileSync, writeFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const timeline = read("../src/data/timeline.json");
const mixing = read("../src/data/mixing.json");
const outro = read("../src/data/outro.json");

const SR = 48000;
const FPS = timeline.fps;
const T = timeline.transition;
const totalFrames = timeline.scenes.reduce((a, s) => a + s.duration, 0) - T * (timeline.scenes.length - 1);
const DUR = totalFrames / FPS;
const N = Math.ceil(DUR * SR);
const L = new Float32Array(N);
const R = new Float32Array(N);

// inicio (s) de cada escena en la línea de tiempo global
const start = {};
let acc = 0;
timeline.scenes.forEach((s, i) => {
  start[s.id] = acc / FPS;
  acc += s.duration - T;
});
const at = (scene, frame) => start[scene] + frame / FPS;

let seed = 1234567;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const noise = () => rnd() * 2 - 1;

const add = (i, v, pan = 0) => {
  if (i < 0 || i >= N) return;
  L[i] += v * Math.min(1, 1 - pan);
  R[i] += v * Math.min(1, 1 + pan);
};

/** Tono con frecuencia y envolvente como funciones del tiempo local. */
const tone = (t0, dur, freq, env, { pan = 0, harm = [1], amp = 1 } = {}) => {
  let ph = 0;
  const i0 = Math.floor(t0 * SR);
  const n = Math.floor(dur * SR);
  for (let k = 0; k < n; k++) {
    const t = k / SR;
    ph += (2 * Math.PI * freq(t)) / SR;
    let v = 0;
    harm.forEach((h, j) => (v += Math.sin(ph * (j + 1)) * h));
    add(i0 + k, v * env(t) * amp, pan);
  }
};

/** Ruido filtrado (filtro de estado variable) con corte y envolvente variables. */
const noiseBurst = (t0, dur, cutoff, env, { q = 0.7, mode = "bp", pan = 0, amp = 1 } = {}) => {
  let low = 0;
  let band = 0;
  const i0 = Math.floor(t0 * SR);
  const n = Math.floor(dur * SR);
  for (let k = 0; k < n; k++) {
    const t = k / SR;
    const f = 2 * Math.sin((Math.PI * Math.min(cutoff(t), SR / 6)) / SR);
    const x = noise();
    low += f * band;
    const high = x - low - q * band;
    band += f * high;
    const v = mode === "lp" ? low : mode === "hp" ? high : band;
    add(i0 + k, v * env(t) * amp, typeof pan === "function" ? pan(t) : pan);
  }
};

const expDecay = (d) => (t) => Math.exp(-t / d);
const attackDecay = (a, d) => (t) => (t < a ? t / a : Math.exp(-(t - a) / d));

/* ---------- 1. Colchón grave ---------- */
{
  const notes = [55, 82.41, 110.0, 164.8];
  notes.forEach((f, j) => {
    tone(
      0,
      DUR,
      (t) => f * (1 + 0.002 * Math.sin(t * 0.7 + j)),
      (t) => {
        const fadeIn = Math.min(1, t / 2.5);
        const fadeOut = Math.min(1, (DUR - t) / 1.2);
        const swell = 0.75 + 0.25 * Math.sin(t * 0.9 + j);
        return fadeIn * fadeOut * swell;
      },
      { amp: [0.07, 0.045, 0.025, 0.012][j], harm: [1, 0.35, 0.12], pan: [-0.2, 0.2, -0.3, 0.3][j] },
    );
  });
}

/* ---------- 2. Ritmo 120 BPM ---------- */
const BEAT = 0.5;
const kick = (t0, amp = 1) =>
  tone(t0, 0.45, (t) => 45 + 95 * Math.exp(-t / 0.035), expDecay(0.13), { amp: 0.55 * amp });
const hat = (t0, amp = 1) =>
  noiseBurst(t0, 0.06, () => 9000, expDecay(0.018), { mode: "hp", amp: 0.12 * amp, pan: 0.25 });
const clank = (t0, amp = 1) => {
  [523, 1187, 1873, 2711].forEach((f, j) =>
    tone(t0, 0.5, () => f, expDecay(0.07 + j * 0.02), { amp: (0.05 / (j + 1)) * amp, pan: -0.3 }),
  );
  noiseBurst(t0, 0.08, () => 3000, expDecay(0.02), { amp: 0.15 * amp });
};
{
  const beatStart = at("Mezclado", 0);
  const beatEnd = at("Cierre", 40);
  for (let t = beatStart, k = 0; t < beatEnd; t += BEAT, k++) {
    kick(t, k % 4 === 0 ? 1 : 0.8);
    if (t > at("Extrusion", 0)) hat(t + BEAT / 2, 1);
    if (t > at("Construccion", 0)) hat(t + BEAT / 4, 0.5);
    if (k % 8 === 4) clank(t, 0.8);
  }
}

/* ---------- 3. Transiciones (whoosh) ---------- */
timeline.scenes.slice(1).forEach((s) => {
  const center = start[s.id] + T / 2 / FPS;
  const d = 0.7;
  noiseBurst(
    center - d * 0.6,
    d,
    (t) => 400 + 5000 * Math.pow(t / d, 2),
    (t) => Math.sin(Math.PI * Math.min(1, t / d)) ** 2,
    { q: 0.5, amp: 0.35, pan: (t) => -0.6 + 1.2 * (t / d) },
  );
});

/* ---------- 4. Escenas ---------- */
// Intro: golpe grave al aparecer el título
{
  const t = at("Intro", 20);
  tone(t, 2.2, (x) => 38 + 30 * Math.exp(-x / 0.25), attackDecay(0.005, 0.7), { amp: 0.7 });
  noiseBurst(t, 1.6, (x) => 1500 * Math.exp(-x / 0.4) + 200, attackDecay(0.002, 0.35), { mode: "lp", amp: 0.5 });
  [220, 330, 440].forEach((f, j) =>
    tone(t, 2.5, () => f, attackDecay(0.4, 1.2), { amp: 0.02, harm: [1, 0.3], pan: j - 1 }),
  );
}
// Mezclado: cada ingrediente que toca fondo suena (detectado de la física)
mixing.items.forEach((it) => {
  const ys = it.track.map((p) => (p ? p[1] : null));
  for (let f = 2; f < ys.length; f++) {
    if (ys[f] === null || ys[f - 1] === null || ys[f - 2] === null) continue;
    const vPrev = ys[f - 1] - ys[f - 2];
    const v = ys[f] - ys[f - 1];
    if (vPrev < -0.06 && v > vPrev * 0.35) {
      const t = at("Mezclado", f) + rnd() * 0.02;
      const big = it.kind === "caucho";
      noiseBurst(t, 0.12, () => (big ? 700 : 2400 + rnd() * 1500), expDecay(big ? 0.03 : 0.012), {
        amp: big ? 0.35 : 0.12,
        pan: it.track[f][0] * 0.6,
        q: 0.4,
      });
      if (big) tone(t, 0.2, () => 110, expDecay(0.05), { amp: 0.25 });
      break;
    }
  }
});
{
  const ramHit = at("Mezclado", 70);
  tone(ramHit, 0.6, (x) => 60 + 40 * Math.exp(-x / 0.05), expDecay(0.15), { amp: 0.55 });
  clank(ramHit, 1.2);
  // rotores
  noiseBurst(at("Mezclado", 60), 1.6, () => 180, (x) => Math.sin(Math.PI * Math.min(1, x / 1.6)) * (0.7 + 0.3 * Math.sin(x * 40)), {
    mode: "lp",
    amp: 0.5,
  });
}
// Extrusión: zumbido de máquina
tone(
  at("Extrusion", 0),
  125 / FPS,
  () => 98,
  (x) => Math.min(1, x / 0.5) * Math.min(1, (125 / FPS - x) / 0.5),
  { amp: 0.05, harm: [1, 0.5, 0.3, 0.2] },
);
// Talón: zumbido que acelera con el giro
tone(
  at("Talon", 6),
  2.2,
  (x) => 260 + 260 * Math.sin(Math.PI * Math.min(1, x / 2.2)),
  (x) => 0.6 * Math.sin(Math.PI * Math.min(1, x / 2.2)),
  { amp: 0.05, harm: [1, 0.4] },
);
// Construcción: "clic" metálico por cada capa
[12, 34, 56, 68, 88, 118, 146].forEach((f, j) => {
  const t = at("Construccion", f);
  tone(t, 0.35, () => 1320 + j * 60, expDecay(0.06), { amp: 0.09, pan: 0.3 });
  tone(t, 0.35, () => 2640 + j * 120, expDecay(0.03), { amp: 0.04, pan: 0.3 });
});
{
  const t = at("Construccion", 168);
  [392, 494, 587].forEach((f) => tone(t, 1.2, () => f, attackDecay(0.01, 0.5), { amp: 0.05, harm: [1, 0.3] }));
}
// Vulcanizado: cierre de prensa, vapor y apertura
{
  const close = at("Vulcanizado", 36);
  tone(close, 0.9, (x) => 42 + 50 * Math.exp(-x / 0.06), expDecay(0.25), { amp: 0.8 });
  clank(close, 1.5);
  noiseBurst(at("Vulcanizado", 42), 2.4, () => 6000, (x) => Math.min(1, x / 0.6) * Math.min(1, (2.4 - x) / 0.8), {
    mode: "hp",
    amp: 0.09,
  });
  noiseBurst(at("Vulcanizado", 100), 1.0, () => 5000, attackDecay(0.05, 0.4), { mode: "hp", amp: 0.22 });
  tone(at("Vulcanizado", 100), 0.8, (x) => 70 + 20 * x, expDecay(0.3), { amp: 0.25 });
}
// Inspección: barrido del escáner, confirmaciones y sello
{
  const t0 = at("Inspeccion", 8);
  tone(t0, 76 / FPS, (x) => 700 + 300 * (x / (76 / FPS)), (x) => 0.5 + 0.5 * Math.sin(x * 50), { amp: 0.03 });
  [34, 52, 70].forEach((f, j) => {
    const t = at("Inspeccion", f);
    tone(t, 0.12, () => 1046, expDecay(0.05), { amp: 0.12 });
    tone(t + 0.09, 0.3, () => 1568 + j * 100, expDecay(0.09), { amp: 0.12 });
  });
  const stamp = at("Inspeccion", 84);
  tone(stamp, 0.6, (x) => 55 + 60 * Math.exp(-x / 0.04), expDecay(0.16), { amp: 0.6 });
  [523, 659, 784].forEach((f) => tone(stamp, 1.4, () => f, attackDecay(0.01, 0.6), { amp: 0.05, harm: [1, 0.4] }));
}
// Cierre: golpes de las llantas al apilarse + rodadura + acorde final
outro.stack.forEach((s, i) => {
  if (s.impact === null) return;
  const t = at("Cierre", s.impact);
  tone(t, 0.7, (x) => 48 + 40 * Math.exp(-x / 0.05), expDecay(0.18), { amp: 0.75 - i * 0.08 });
  noiseBurst(t, 0.25, () => 900, expDecay(0.05), { mode: "lp", amp: 0.4 });
});
noiseBurst(at("Cierre", outro.roller.spawn), 2.0, () => 260, (x) => Math.max(0, 1 - x / 2.0) * 0.8, {
  mode: "lp",
  amp: 0.45,
  pan: (x) => -0.8 + 0.8 * Math.min(1, x / 1.2),
});
{
  const t = at("Cierre", 30);
  tone(t, 2.6, (x) => 36 + 25 * Math.exp(-x / 0.3), attackDecay(0.005, 0.9), { amp: 0.6 });
  [220, 277.2, 329.6, 440].forEach((f, j) =>
    tone(t, 2.6, () => f, (x) => attackDecay(0.02, 1.1)(x) * Math.min(1, (DUR - (t + x)) / 0.4), {
      amp: 0.035,
      harm: [1, 0.4, 0.15],
      pan: j / 2 - 0.75,
    }),
  );
}

/* ---------- Master ---------- */
// reverberación sencilla (combs) para dar espacio
const reverb = (buf) => {
  const out = new Float32Array(buf.length);
  const delays = [1557, 1617, 1491, 1422].map((d) => Math.floor((d * SR) / 44100));
  delays.forEach((d) => {
    const line = new Float32Array(d);
    let idx = 0;
    for (let i = 0; i < buf.length; i++) {
      const y = line[idx];
      line[idx] = buf[i] + y * 0.78;
      out[i] += y * 0.12;
      idx = (idx + 1) % d;
    }
  });
  return out;
};
const rl = reverb(L);
const rr = reverb(R);
let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh((L[i] + rl[i]) * 1.1);
  R[i] = Math.tanh((R[i] + rr[i]) * 1.1);
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const gain = 0.89 / peak;
// fundido final
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const f = Math.min(1, (DUR - t) / 0.35);
  L[i] *= gain * f;
  R[i] *= gain * f;
}

const data = Buffer.alloc(44 + N * 4);
data.write("RIFF", 0);
data.writeUInt32LE(36 + N * 4, 4);
data.write("WAVE", 8);
data.write("fmt ", 12);
data.writeUInt32LE(16, 16);
data.writeUInt16LE(1, 20);
data.writeUInt16LE(2, 22);
data.writeUInt32LE(SR, 24);
data.writeUInt32LE(SR * 4, 28);
data.writeUInt16LE(4, 32);
data.writeUInt16LE(16, 34);
data.write("data", 36);
data.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4);
}
writeFileSync(new URL("../public/audio/soundtrack.wav", import.meta.url), data);
console.log(`soundtrack.wav: ${DUR.toFixed(2)} s, pico previo ${peak.toFixed(2)}`);
