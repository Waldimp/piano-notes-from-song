import { LOGO_BODY, LOGO_LID, LOGO_VIEWBOX } from "@/lib/brand/logo-path";

/**
 * Tonos del logo. `duo` es el oficial de la app: tapa matcha, cuerpo carob.
 * `current` hereda `color` del contenedor (útil en botones y textos).
 */
export type LogoTone = "duo" | "carob" | "matcha" | "chai" | "ink" | "paper" | "current";

const TONES: Record<Exclude<LogoTone, "duo" | "current">, string> = {
  carob: "#725c3a",
  matcha: "#809671",
  chai: "#d2ab80",
  ink: "#4a3b25",
  paper: "#fffdf8",
};

export default function Logo({
  className = "",
  tone = "duo",
  animate = false,
  title,
}: {
  className?: string;
  tone?: LogoTone;
  /** Entra dibujándose: primero el cuerpo, luego la tapa. */
  animate?: boolean;
  /** Si se pasa, el SVG deja de ser decorativo y se anuncia con este nombre. */
  title?: string;
}) {
  const lid = tone === "duo" ? TONES.matcha : tone === "current" ? "currentColor" : TONES[tone];
  const body = tone === "duo" ? TONES.carob : tone === "current" ? "currentColor" : TONES[tone];
  return (
    <svg
      className={`illo logo${animate ? " logo-in" : ""}${className ? ` ${className}` : ""}`}
      viewBox={LOGO_VIEWBOX}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <path className="logo-body" d={LOGO_BODY} fill={body} />
      <path className="logo-lid" d={LOGO_LID} fill={lid} />
    </svg>
  );
}
