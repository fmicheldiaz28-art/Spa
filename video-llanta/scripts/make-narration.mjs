// Monta la narración sobre la línea de tiempo del video.
//
// Uso: node scripts/make-narration.mjs [archivo.mp3] [--cuts=t2,...,t8] [--tempo=1.0]
//   (por defecto assets/narracion.mp3)
//
// El audio debe leer las 8 frases de LINES en orden (una por escena). El script
// detecta los silencios, elige los 7 cortes que mejor encajan con la longitud de
// cada frase y coloca cada frase al inicio de su escena, sin pisar la anterior.
// Si no cabe en la duración del video, acelera la voz (sin cambiar el tono).
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const timeline = read("../src/data/timeline.json");
const args = process.argv.slice(2);
const opt = (name) =>
  args.find((x) => x.startsWith(`--${name}=`))?.split("=")[1];
const SRC =
  args.find((x) => !x.startsWith("--")) ??
  new URL("../assets/narracion.mp3", import.meta.url).pathname;
// --cuts=3.04,7.76,... : inicio aproximado de las frases 2..8 (p. ej. de una
// transcripción con marcas de tiempo). Se ajusta al mínimo de energía cercano.
// Si no se pasan, se leen de assets/narracion.json (si existe).
let CONFIG = {};
try {
  CONFIG = JSON.parse(
    readFileSync(new URL("../assets/narracion.json", import.meta.url)),
  );
} catch {
  CONFIG = {};
}
const CUTS = opt("cuts")?.split(",").map(Number) ?? CONFIG.cuts;
// --tempo=1.0 : velocidad base de la voz
const TEMPO_OPT = opt("tempo") ? Number(opt("tempo")) : (CONFIG.tempo ?? null);
const OUT = new URL("../public/audio/narration.wav", import.meta.url).pathname;
const FPS = timeline.fps;
const T = timeline.transition;
const GAP = 0.15;

const LINES = [
  { scene: "Intro", text: "Así se fabrica una llanta radial de camión." },
  {
    scene: "Mezclado",
    text: "Caucho, negro de humo, sílice y azufre se mezclan en la Banbury.",
  },
  {
    scene: "Extrusion",
    text: "Se forma la banda y el acero se cubre de caucho.",
  },
  { scene: "Talon", text: "Alambre de acero forma los talones." },
  {
    scene: "Construccion",
    text: "Capa a capa, en el tambor, nace la llanta verde.",
  },
  {
    scene: "Vulcanizado",
    text: "Calor y presión vulcanizan el caucho y graban el dibujo.",
  },
  { scene: "Inspeccion", text: "Rayos X y control final: aprobada." },
  { scene: "Cierre", text: "Double Coin y Gomax. De caucho a carretera." },
];

/* ---------- 1. Silencios y tramos de voz ---------- */
const duration = parseFloat(
  execFileSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    SRC,
  ]).toString(),
);
// silencedetect escribe en stderr
const log = spawnSync(
  "ffmpeg",
  [
    "-hide_banner",
    "-i",
    SRC,
    "-af",
    "silencedetect=noise=-38dB:d=0.12",
    "-f",
    "null",
    "-",
  ],
  {
    encoding: "utf8",
  },
).stderr;
const sil = [];
let cur = null;
for (const line of log.split("\n")) {
  const s = line.match(/silence_start: ([\d.]+)/);
  const e = line.match(/silence_end: ([\d.]+)/);
  if (s) cur = { start: parseFloat(s[1]) };
  if (e && cur) {
    cur.end = parseFloat(e[1]);
    sil.push(cur);
    cur = null;
  }
}
if (cur) sil.push({ start: cur.start, end: duration });
const speechStart = sil.length && sil[0].start < 0.05 ? sil[0].end : 0;
const speechEnd =
  sil.length && sil.at(-1).end >= duration - 0.05 ? sil.at(-1).start : duration;
const cands = sil.filter(
  (s) => s.start > speechStart + 0.3 && s.end < speechEnd - 0.3,
);

/* ---------- 2. Elegir los 7 cortes (programación dinámica) ---------- */
const chars = LINES.map((l) => l.text.length);
const totalChars = chars.reduce((a, b) => a + b, 0);
const N = LINES.length;
const span =
  speechEnd - speechStart - cands.reduce((a, s) => a + (s.end - s.start), 0);
const expected = chars.map((c) => (c / totalChars) * span);
// tiempo de voz (sin silencios) entre dos puntos
const voiced = (a, b) =>
  b -
  a -
  cands.reduce(
    (acc, s) =>
      acc +
      Math.max(
        0,
        Math.min(b, s.start + (s.end - s.start)) - Math.max(a, s.start),
      ),
    0,
  );
const bound = (k) =>
  k === -1
    ? { end: speechStart }
    : k === cands.length
      ? { start: speechEnd }
      : cands[k];
const memo = new Map();
const best = (i, prev) => {
  // i = índice de la frase que empieza tras el corte "prev"
  const key = `${i}:${prev}`;
  if (memo.has(key)) return memo.get(key);
  const from = bound(prev).end;
  let res;
  if (i === N - 1) {
    const d = voiced(from, speechEnd);
    res = { cost: (d - expected[i]) ** 2, cuts: [] };
  } else {
    res = { cost: Infinity, cuts: [] };
    for (let k = prev + 1; k < cands.length; k++) {
      const d = voiced(from, cands[k].start);
      const pause = cands[k].end - cands[k].start;
      const c = (d - expected[i]) ** 2 - 0.6 * pause; // premia pausas largas (fin de frase)
      const rest = best(i + 1, k);
      if (c + rest.cost < res.cost)
        res = { cost: c + rest.cost, cuts: [k, ...rest.cuts] };
    }
  }
  memo.set(key, res);
  return res;
};
// Punto de menor energía (ventanas de 10 ms) dentro de [a, b]. Se decodifica el
// archivo entero una vez: decodificar desde -ss mete silencio de arranque.
let PCM = null;
const quietest = (a, b) => {
  PCM ??= execFileSync(
    "ffmpeg",
    [
      "-loglevel",
      "error",
      "-i",
      SRC,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "s16le",
      "-",
    ],
    { maxBuffer: 1 << 28 },
  );
  const SR = 16000;
  const win = 160;
  const n = PCM.length / 2;
  let bestT = (a + b) / 2;
  let bestE = Infinity;
  for (
    let k = Math.max(0, Math.floor(a * SR));
    k + win <= Math.min(n, Math.ceil(b * SR));
    k += win / 2
  ) {
    let e = 0;
    for (let m = k; m < k + win; m++) e += Math.abs(PCM.readInt16LE(m * 2));
    if (e < bestE) {
      bestE = e;
      bestT = (k + win / 2) / SR;
    }
  }
  return bestT;
};

let clips;
if (CUTS) {
  if (CUTS.length !== N - 1)
    throw new Error(`--cuts necesita ${N - 1} valores`);
  const cutAt = CUTS.map((t) => quietest(t - 0.35, t + 0.02));
  clips = LINES.map((l, i) => ({
    ...l,
    in: i === 0 ? Math.max(0, speechStart - 0.04) : cutAt[i - 1],
    out: i === N - 1 ? Math.min(duration, speechEnd + 0.08) : cutAt[i],
  }));
} else {
  const result = best(0, -1);
  if (result.cuts.length !== N - 1)
    throw new Error(
      `Cortes encontrados: ${result.cuts.length} (cands ${cands.length}, coste ${result.cost})`,
    );
  const cuts = result.cuts;
  clips = LINES.map((l, i) => ({
    ...l,
    in: Math.max(0, bound(i === 0 ? -1 : cuts[i - 1]).end - 0.04),
    out: Math.min(
      duration,
      (i === N - 1 ? speechEnd : cands[cuts[i]].start) + 0.08,
    ),
  }));
}

/* ---------- 3. Colocar cada frase en su escena ---------- */
const visible = {};
let acc = 0;
timeline.scenes.forEach((s, i) => {
  visible[s.id] = i === 0 ? 0 : (acc + T / 2) / FPS;
  acc += s.duration - T;
});
const TOTAL = (acc + T) / FPS;

// Velocidad base y máxima (atempo no cambia el tono). Pasada hacia atrás: lo más
// tarde que puede empezar cada frase para que todo quepa; pasada hacia delante: cada
// frase empieza al aparecer su escena (o al terminar la anterior), sin pasarse de ese
// límite, y solo se acelera lo necesario.
const BASE_TEMPO = TEMPO_OPT ?? 1.0;
const MAX_TEMPO = Math.max(BASE_TEMPO, 1.1);
const END = TOTAL - 0.08;
const dur = clips.map((c) => c.out - c.in);
// lo más tarde que puede empezar cada frase, a velocidad base y a velocidad máxima
const backward = (tempo) => {
  const ls = new Array(N);
  let limit = END;
  for (let i = N - 1; i >= 0; i--) {
    ls[i] = limit - dur[i] / tempo;
    limit = ls[i] - GAP;
  }
  return ls;
};
const latestBase = backward(BASE_TEMPO);
const latestMax = backward(MAX_TEMPO);
let cursor = 0.15;
const placed = clips.map((c, i) => {
  const latestEnd = i === N - 1 ? END : latestMax[i + 1] - GAP;
  // empieza al aparecer su escena; si así no cabe, se adelanta (antes que acelerar)
  const start = Math.max(
    cursor,
    Math.min(visible[c.scene] + 0.12, latestBase[i]),
  );
  const tempo = Math.min(
    MAX_TEMPO,
    Math.max(BASE_TEMPO, dur[i] / (latestEnd - start)),
  );
  const end = start + dur[i] / tempo;
  cursor = end + GAP;
  return {
    ...c,
    tempo: +tempo.toFixed(3),
    start: +start.toFixed(3),
    end: +end.toFixed(3),
  };
});

/* ---------- 4. Mezcla con ffmpeg ---------- */
const parts = placed
  .map((c, i) => {
    const d = c.out - c.in;
    const ms = Math.round(c.start * 1000);
    const tempoFx = c.tempo !== 1 ? `,atempo=${c.tempo}` : "";
    return `[0]atrim=${c.in.toFixed(3)}:${c.out.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.012,afade=t=out:st=${(d - 0.04).toFixed(3)}:d=0.04${tempoFx},adelay=${ms}|${ms}[c${i}]`;
  })
  .join(";");
const mix = `${placed.map((_, i) => `[c${i}]`).join("")}amix=inputs=${placed.length}:normalize=0,apad,aresample=48000,aformat=channel_layouts=stereo[out]`;
execFileSync("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-i",
  SRC,
  "-filter_complex",
  `${parts};${mix}`,
  "-map",
  "[out]",
  "-t",
  String(TOTAL),
  OUT,
]);

writeFileSync(
  new URL("../src/data/narration.json", import.meta.url),
  JSON.stringify(
    {
      clips: placed.map(({ scene, text, start, end, tempo }) => ({
        scene,
        text,
        start,
        end,
        tempo,
      })),
    },
    null,
    2,
  ) + "\n",
);
console.log(`fuente ${duration.toFixed(2)} s`);
placed.forEach((c) =>
  console.log(
    `${c.start.toFixed(2).padStart(6)}–${c.end.toFixed(2).padEnd(6)} [${c.scene.padEnd(12)} visible ${visible[c.scene].toFixed(2).padStart(5)} · x${c.tempo} · origen ${c.in.toFixed(2)}–${c.out.toFixed(2)}] ${c.text}`,
  ),
);
