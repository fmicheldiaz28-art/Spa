import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { C, STEPS, bodyFont, displayFont } from "../theme";

const ease = Easing.bezier(0.16, 1, 0.3, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Encabezado de paso: "PASO 01 / 06", título y descripción. */
export const StepHeader: React.FC<{
  step: number;
  title: string;
  subtitle: string;
  delay?: number;
}> = ({ step, title, subtitle, delay = 6 }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ padding: "130px 84px 0", pointerEvents: "none" }}>
      <div
        style={{
          fontFamily: displayFont,
          fontWeight: 600,
          fontSize: 40,
          letterSpacing: 6,
          color: C.accent,
          opacity: interpolate(frame, [delay, delay + 12], [0, 1], {
            ...clamp,
            easing: ease,
          }),
          translate: interpolate(
            frame,
            [delay, delay + 12],
            ["0px 24px", "0px 0px"],
            {
              ...clamp,
              easing: ease,
            },
          ),
        }}
      >
        PASO {String(step).padStart(2, "0")} / 06
      </div>
      <div
        style={{
          fontFamily: displayFont,
          fontWeight: 800,
          fontSize: 128,
          lineHeight: 0.95,
          color: C.ink,
          textTransform: "uppercase",
          marginTop: 10,
          opacity: interpolate(frame, [delay + 3, delay + 16], [0, 1], {
            ...clamp,
            easing: ease,
          }),
          translate: interpolate(
            frame,
            [delay + 3, delay + 16],
            ["0px 36px", "0px 0px"],
            {
              ...clamp,
              easing: ease,
            },
          ),
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: bodyFont,
          fontWeight: 500,
          fontSize: 44,
          lineHeight: 1.25,
          color: C.muted,
          marginTop: 22,
          maxWidth: 900,
          opacity: interpolate(frame, [delay + 8, delay + 22], [0, 1], {
            ...clamp,
            easing: ease,
          }),
          translate: interpolate(
            frame,
            [delay + 8, delay + 22],
            ["0px 30px", "0px 0px"],
            {
              ...clamp,
              easing: ease,
            },
          ),
        }}
      >
        {subtitle}
      </div>
    </AbsoluteFill>
  );
};

/** Barra de progreso de los 6 pasos. */
export const Progress: React.FC<{ step: number }> = ({ step }) => {
  const frame = useCurrentFrame();
  const fill = interpolate(frame, [4, 24], [0, 1], { ...clamp, easing: ease });
  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        padding: "0 84px 110px",
        pointerEvents: "none",
      }}
    >
      <div style={{ display: "flex", gap: 12 }}>
        {STEPS.map((name, i) => {
          const idx = i + 1;
          const done = idx < step;
          const current = idx === step;
          return (
            <div key={name} style={{ flex: 1 }}>
              <div
                style={{
                  height: 8,
                  borderRadius: 4,
                  background: "rgba(255,255,255,0.14)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: done ? "100%" : current ? `${fill * 100}%` : "0%",
                    background: done ? "rgba(255,122,26,0.55)" : C.accent,
                  }}
                />
              </div>
              <div
                style={{
                  fontFamily: displayFont,
                  fontWeight: 600,
                  fontSize: 25,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  marginTop: 12,
                  color: current ? C.ink : "rgba(255,255,255,0.38)",
                  textAlign: "center",
                }}
              >
                {name}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/** Fondo con degradado radial y viñeta. */
export const Backdrop: React.FC<{ glow?: string; y?: string }> = ({
  glow = "rgba(255,122,26,0.10)",
  y = "58%",
}) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(120% 70% at 50% ${y}, ${glow} 0%, rgba(0,0,0,0) 60%), linear-gradient(180deg, #0d1014 0%, ${C.bg} 55%, #050607 100%)`,
    }}
  />
);

/** Velo superior/inferior para que el texto se lea sobre el 3D. */
export const Scrims: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        "linear-gradient(180deg, rgba(5,6,8,0.85) 0%, rgba(5,6,8,0.0) 30%, rgba(5,6,8,0) 80%, rgba(5,6,8,0.8) 100%)",
      pointerEvents: "none",
    }}
  />
);

/** Etiqueta/chip con dato clave. */
export const Chip: React.FC<{
  children: React.ReactNode;
  from: number;
  color?: string;
  style?: React.CSSProperties;
}> = ({ children, from, color = C.accent, style }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 16,
        padding: "14px 26px",
        borderRadius: 999,
        background: "rgba(12,14,18,0.78)",
        border: `2px solid ${color}`,
        color: C.ink,
        fontFamily: displayFont,
        fontWeight: 600,
        fontSize: 44,
        letterSpacing: 1,
        opacity: interpolate(frame, [from, from + 10], [0, 1], {
          ...clamp,
          easing: ease,
        }),
        scale: interpolate(frame, [from, from + 10], [0.85, 1], {
          ...clamp,
          easing: ease,
        }),
        ...style,
      }}
    >
      {children}
    </div>
  );
};
