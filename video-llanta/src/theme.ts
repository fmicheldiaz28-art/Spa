import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

// Fuentes locales (Barlow, SIL OFL 1.1) para no depender de la red al renderizar.
export const displayFont = "Barlow Condensed";
export const bodyFont = "Barlow";

const fonts: [string, string, string][] = [
  [displayFont, "600", "barlow-condensed-latin-600-normal.woff2"],
  [displayFont, "800", "barlow-condensed-latin-800-normal.woff2"],
  [bodyFont, "500", "barlow-latin-500-normal.woff2"],
  [bodyFont, "600", "barlow-latin-600-normal.woff2"],
];
fonts.forEach(([family, weight, file]) => {
  loadFont({ family, weight, url: staticFile(`fonts/${file}`) });
});

export const C = {
  bg: "#0a0c0f",
  ink: "#f4f1ea",
  muted: "#b7bec7",
  accent: "#ff7a1a",
  heat: "#ff4d00",
  steel: "#aab7c4",
  cyan: "#5fe1ff",
  rubber: "#1b1b1c",
  natural: "#c8a15f",
  silica: "#e9ecef",
  sulfur: "#f2c53d",
  bronze: "#b9874a",
};

export const STEPS = [
  "Mezclado",
  "Extrusión",
  "Talón",
  "Construcción",
  "Vulcanizado",
  "Inspección",
];
