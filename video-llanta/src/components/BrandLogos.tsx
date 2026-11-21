import {
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import brands from "../data/brands.json";
import { C, displayFont } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.16, 1, 0.3, 1);

type Brand = { name: string; logo: string | null };

/**
 * Marcas del video. Si en src/data/brands.json una marca tiene "logo"
 * (ruta dentro de public/, p. ej. "logos/double-coin.png") se muestra la imagen;
 * si no, se muestra el nombre como texto.
 */
export const BrandLogos: React.FC<{
  from: number;
  height?: number;
  gap?: number;
  color?: string;
}> = ({ from, height = 90, gap = 44, color = C.ink }) => {
  const frame = useCurrentFrame();
  const list = brands.brands as Brand[];
  return (
    <div style={{ display: "flex", alignItems: "center", gap }}>
      {list.map((b, i) => {
        const t0 = from + i * 5;
        return (
          <div
            key={b.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap,
              opacity: interpolate(frame, [t0, t0 + 12], [0, 1], {
                ...clamp,
                easing: ease,
              }),
              translate: interpolate(
                frame,
                [t0, t0 + 12],
                ["0px 20px", "0px 0px"],
                {
                  ...clamp,
                  easing: ease,
                },
              ),
            }}
          >
            {i > 0 ? (
              <div
                style={{
                  width: Math.max(2, height * 0.03),
                  height: height * 0.72,
                  background: C.accent,
                }}
              />
            ) : null}
            {b.logo ? (
              <Img
                src={staticFile(b.logo)}
                style={{ height, objectFit: "contain" }}
              />
            ) : (
              <span
                style={{
                  fontFamily: displayFont,
                  fontWeight: 800,
                  fontSize: height * 0.7,
                  lineHeight: 1,
                  letterSpacing: height * 0.05,
                  color,
                  whiteSpace: "nowrap",
                }}
              >
                {b.name}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};
