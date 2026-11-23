// Monta la narración (TTS de Higgsfield, voz "Isabella") sobre la línea de tiempo:
// quita los nombres de escena hablados y coloca cada frase al inicio de su escena.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const timeline = read("../src/data/timeline.json");
const SRC = new URL("../assets/narracion-original.mp3", import.meta.url)
  .pathname;
const OUT = new URL("../public/audio/narration.wav", import.meta.url).pathname;
const FPS = timeline.fps;
const T = timeline.transition;
const TEMPO = 1.04; // un 4 % más rápido, sin cambiar el tono
const GAP = 0.15;

// Tramos del audio original (segundos). Los nombres de escena hablados
// ("Mezclado", "Extrusión y calandrado", "Talón", "Construcción", "Vulcanizado",
// "Inspección") quedan fuera.
const GROUPS = [
  {
    scene: "Intro",
    clips: [
      {
        text: "Así se fabrica una llanta radial de camión.",
        in: 0.0,
        out: 3.06,
      },
    ],
  },
  {
    scene: "Mezclado",
    clips: [
      { text: "Caucho, negro de humo, sílice y azufre", in: 4.93, out: 8.16 },
      { text: "se mezclan en la Banbury.", in: 8.53, out: 9.97 },
    ],
  },
  {
    scene: "Extrusion",
    clips: [
      {
        text: "Se forma la banda y el acero se cubre de caucho.",
        in: 13.51,
        out: 16.3,
      },
    ],
  },
  {
    scene: "Talon",
    clips: [
      { text: "Alambre de acero forma los talones.", in: 18.96, out: 21.1 },
    ],
  },
  {
    scene: "Construccion",
    clips: [
      { text: "Capa a capa, en el tambor,", in: 23.78, out: 25.57 },
      { text: "nace la llanta verde.", in: 26.06, out: 27.44 },
    ],
  },
  {
    scene: "Vulcanizado",
    clips: [
      {
        text: "Calor y presión vulcanizan el caucho y graban el dibujo.",
        in: 30.43,
        out: 33.58,
      },
    ],
  },
  {
    scene: "Inspeccion",
    clips: [
      { text: "Rayos X y control final:", in: 36.62, out: 38.34 },
      { text: "aprobada.", in: 38.77, out: 39.49 },
    ],
  },
  {
    scene: "Cierre",
    lead: 0.25, // empieza justo antes del corte para terminar dentro de los 30 s
    clips: [
      { text: "Double Coin y Gomax.", in: 40.54, out: 42.03 },
      { text: "De caucho a carretera.", in: 42.66, out: 44.04 },
    ],
  },
];

// Momento (s) en que cada escena pasa a ser la visible: mitad de su transición de entrada.
const visible = {};
let acc = 0;
timeline.scenes.forEach((s, i) => {
  visible[s.id] = i === 0 ? 0 : (acc + T / 2) / FPS;
  acc += s.duration - T;
});
const TOTAL = acc / FPS + T / FPS;

let cursor = 0.15;
const placed = [];
for (const g of GROUPS) {
  const target = visible[g.scene] + 0.12 - (g.lead ?? 0);
  let t = Math.max(target, cursor);
  g.clips.forEach((c, k) => {
    if (k > 0) t += GAP;
    const dur = (c.out - c.in) / TEMPO;
    placed.push({
      ...c,
      scene: g.scene,
      start: +t.toFixed(3),
      end: +(t + dur).toFixed(3),
    });
    t += dur;
  });
  cursor = t + GAP;
}

const inputs = placed
  .map((c, i) => {
    const d = c.out - c.in;
    const ms = Math.round(c.start * 1000);
    return `[0]atrim=${c.in}:${c.out},asetpts=PTS-STARTPTS,afade=t=in:d=0.012,afade=t=out:st=${(d - 0.04).toFixed(3)}:d=0.04,atempo=${TEMPO},adelay=${ms}|${ms}[c${i}]`;
  })
  .join(";");
const mix = `${placed.map((_, i) => `[c${i}]`).join("")}amix=inputs=${placed.length}:normalize=0,apad,atrim=0:${TOTAL},aresample=48000,aformat=channel_layouts=stereo[out]`;
execFileSync("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-i",
  SRC,
  "-filter_complex",
  `${inputs};${mix}`,
  "-map",
  "[out]",
  OUT,
]);

writeFileSync(
  new URL("../src/data/narration.json", import.meta.url),
  JSON.stringify(
    {
      tempo: TEMPO,
      clips: placed.map(({ scene, text, start, end }) => ({
        scene,
        text,
        start,
        end,
      })),
    },
    null,
    2,
  ) + "\n",
);
placed.forEach((c) =>
  console.log(
    `${c.start.toFixed(2).padStart(6)}–${c.end.toFixed(2).padEnd(6)} [${c.scene.padEnd(12)} visible ${visible[c.scene].toFixed(2)}] ${c.text}`,
  ),
);
console.log("narration.wav", TOTAL.toFixed(2), "s");
