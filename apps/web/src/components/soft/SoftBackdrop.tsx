/**
 * Fondo "acuarela" de Pianissimo: manchas suaves en las esquinas, notas que
 * caen como barras pastel y destellos. Todo CSS (transform/opacity), sin
 * estado de React; respeta prefers-reduced-motion desde globals.css.
 */

type Props = {
  /** Intensidad de la lluvia de notas: 0 = ninguna. */
  rain?: number;
  /** Nubes acuarela abajo (como en la inspo). */
  clouds?: boolean;
  sparkles?: boolean;
  /** Lluvia solo en los bordes (20 % a cada lado): deja limpio el centro para logo y texto. */
  rainEdges?: boolean;
  className?: string;
};

const RAIN = [
  { x: 4, h: 22, d: 0, t: 11, c: "m" },
  { x: 9, h: 14, d: 3.2, t: 13, c: "p" },
  { x: 16, h: 30, d: 1.1, t: 12, c: "c" },
  { x: 24, h: 12, d: 5.4, t: 14, c: "m" },
  { x: 31, h: 26, d: 2.6, t: 10.5, c: "p" },
  { x: 40, h: 16, d: 7.1, t: 13.5, c: "c" },
  { x: 52, h: 20, d: 0.8, t: 12.5, c: "m" },
  { x: 61, h: 32, d: 4.4, t: 11.5, c: "p" },
  { x: 70, h: 12, d: 6.2, t: 14.5, c: "m" },
  { x: 78, h: 24, d: 1.9, t: 12, c: "c" },
  { x: 86, h: 18, d: 3.7, t: 13, c: "m" },
  { x: 94, h: 28, d: 5.9, t: 11, c: "p" },
];

const SPARKS = [
  { x: 12, y: 18, d: 0 },
  { x: 86, y: 14, d: 1.3 },
  { x: 22, y: 62, d: 2.1 },
  { x: 74, y: 48, d: 0.7 },
  { x: 50, y: 30, d: 2.8 },
  { x: 92, y: 70, d: 1.9 },
];

const edgeX = (x: number) => (x < 50 ? 2 + x * 0.36 : 80 + (x - 50) * 0.36);

export default function SoftBackdrop({ rain = 1, clouds = true, sparkles = true, rainEdges = false, className = "" }: Props) {
  return (
    <div className={`soft-backdrop${className ? ` ${className}` : ""}`} aria-hidden="true">
      <i className="soft-blob a" />
      <i className="soft-blob b" />
      {rain > 0 &&
        RAIN.filter((_, i) => i < Math.round(RAIN.length * Math.min(1, rain))).map((r, i) => (
          <i
            key={i}
            className={`soft-rain ${r.c}`}
            style={
              {
                "--x": `${rainEdges ? edgeX(r.x) : r.x}%`,
                "--h": `${r.h}vh`,
                "--d": `${r.d}s`,
                "--t": `${r.t}s`,
              } as React.CSSProperties
            }
          />
        ))}
      {sparkles &&
        SPARKS.map((s, i) => (
          <i key={`s${i}`} className="sparkle" style={{ left: `${s.x}%`, top: `${s.y}%`, animationDelay: `${s.d}s` }} />
        ))}
      {clouds && (
        <svg className="soft-clouds" viewBox="0 0 400 120" preserveAspectRatio="none">
          <path d="M0 120 L0 70 C 30 50, 60 80, 95 62 C 130 45, 150 85, 190 70 C 230 55, 250 95, 290 72 C 330 50, 360 85, 400 66 L400 120 Z" fill="#b3b792" opacity="0.28" />
          <path d="M0 120 L0 92 C 40 78, 80 104, 130 88 C 180 72, 210 108, 260 92 C 310 76, 350 108, 400 90 L400 120 Z" fill="#809671" opacity="0.22" />
        </svg>
      )}
    </div>
  );
}
