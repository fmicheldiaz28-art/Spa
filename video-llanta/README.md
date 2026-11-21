# Video: fabricación de una llanta radial de camión

Video vertical (1080×1920, 30 fps, 30 s) hecho con código:

- **Remotion** para la línea de tiempo, los textos y el render a MP4.
- **three.js + React Three Fiber** (`@remotion/three`) para todo el 3D: la llanta es una `LatheGeometry`
  con perfil de superelipse y con el dibujo de la banda y el marcaje del costado pintados en un canvas.
- **Rapier** (`@dimforge/rapier3d-compat`) para la física: ingredientes cayendo en la Banbury y llantas
  apilándose. Como Remotion renderiza fotogramas en paralelo, la física se **precalcula** en
  `scripts/bake-physics.mjs` y se reproduce desde `src/data/*.json`.
- **Audio sintetizado** en `scripts/make-audio.mjs`: el ritmo, las transiciones y los golpes están
  sincronizados con la línea de tiempo y con los impactos de la física.

## Escenas

| # | Escena | Archivo |
|---|--------|---------|
| 0 | Intro | `src/scenes/Intro.tsx` |
| 1 | Mezclado (Banbury + física) | `src/scenes/Mixing.tsx` |
| 2 | Extrusión y calandrado | `src/scenes/Extrusion.tsx` |
| 3 | Talón | `src/scenes/Bead.tsx` |
| 4 | Construcción en tambor → llanta verde | `src/scenes/Building.tsx` |
| 5 | Vulcanizado en prensa | `src/scenes/Curing.tsx` |
| 6 | Inspección por rayos X | `src/scenes/XRay.tsx` |
| 7 | Cierre (apilado con física) | `src/scenes/Outro.tsx` |

Las duraciones están en `src/data/timeline.json`.

## Comandos

```bash
npm i
npm run bake     # (opcional) recalcula la física y el audio
npm run dev      # Remotion Studio
npm run render   # genera out/llanta-radial.mp4
```

Fuentes: Barlow / Barlow Condensed (SIL Open Font License), incluidas en `public/fonts`.
