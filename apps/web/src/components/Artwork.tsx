/**
 * Portada generativa determinista de cada canción (sin IA externa).
 *
 * A partir del título se deriva un PRNG y con él: una pareja de colores de la
 * paleta Pianissimo, una "onda" (curva suave), un conjunto de barras/notas con
 * alturas rítmicas, y una franja de piano abstracto con teclas pulsadas.
 * Mismo título → misma portada, siempre; títulos distintos → variedad con
 * identidad común (dorado + luz sobre fondo profundo).
 */

const PALETTES: Array<[string, string, string]> = [
  // [fondo A, fondo B, acento]
  ["#e3e7d4", "#b3b792", "#809671"], // pistache → matcha
  ["#f1e6d4", "#e5d2b8", "#d2ab80"], // vainilla → chai
  ["#e9e4dc", "#d3cab9", "#725c3a"], // almendra → carob
  ["#e6ead9", "#c7cfb0", "#6f8563"], // salvia clara → verde
  ["#f0e4d2", "#dcc3a2", "#a7845c"], // arena → nuez
  ["#eaece2", "#c3c8ad", "#809671"], // niebla verde → matcha
  ["#efe6d9", "#dfcfb7", "#b8905f"], // papel → caramelo
  ["#e4e9dc", "#bfc6a8", "#5f7254"], // menta pálida → musgo
];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function prng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export type ArtworkSpec = {
  palette: [string, string, string];
  bars: number[];
  pressed: number[];
  wave: string;
  angle: number;
  orb: { x: number; y: number; r: number };
};

export function artworkSpec(seed: string): ArtworkSpec {
  const h = hash(seed);
  const rand = prng(h);
  const palette = PALETTES[h % PALETTES.length];
  const bars: number[] = [];
  let level = 0.35 + rand() * 0.3;
  for (let i = 0; i < 14; i++) {
    level += (rand() - 0.5) * 0.45;
    level = Math.max(0.12, Math.min(0.95, level));
    bars.push(level);
  }
  const pressed = Array.from({ length: 14 }, (_, i) => i).filter(() => rand() < 0.28);
  // Onda suave: polilínea cúbica sobre 8 puntos
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 8; i++) pts.push([i * (160 / 8), 62 + (rand() - 0.5) * 34]);
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
  }
  return {
    palette,
    bars,
    pressed,
    wave: d,
    angle: Math.round(rand() * 90) + 20,
    orb: { x: 40 + rand() * 80, y: 20 + rand() * 40, r: 26 + rand() * 30 },
  };
}

export default function Artwork({
  seed,
  className = "",
  glyph = "♪",
  muted = false,
}: {
  seed: string;
  className?: string;
  glyph?: string;
  muted?: boolean;
}) {
  const spec = artworkSpec(seed);
  const [a, b, light] = spec.palette;
  const id = `aw${hash(seed).toString(36)}`;
  return (
    <svg
      className={`artwork${className ? ` ${className}` : ""}${muted ? " muted" : ""}`}
      viewBox="0 0 160 100"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label=""
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-bg`} gradientTransform={`rotate(${spec.angle})`}>
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
        <radialGradient id={`${id}-orb`}>
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-bar`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={light} stopOpacity="0.95" />
          <stop offset="1" stopColor={light} stopOpacity="0.25" />
        </linearGradient>
      </defs>
      <rect width="160" height="100" fill={`url(#${id}-bg)`} />
      <circle cx={spec.orb.x} cy={spec.orb.y} r={spec.orb.r} fill={`url(#${id}-orb)`} />
      <path d={spec.wave} fill="none" stroke={light} strokeOpacity="0.35" strokeWidth="1.2" />
      <g className="artwork-bars">
        {spec.bars.map((v, i) => {
          const x = 10 + i * 10.2;
          const hgt = v * 46;
          return <rect key={i} x={x} y={78 - hgt} width="6" height={hgt} rx="2" fill={`url(#${id}-bar)`} />;
        })}
      </g>
      {/* piano abstracto */}
      <g>
        <rect x="0" y="80" width="160" height="20" fill="#fffdf8" />
        {Array.from({ length: 14 }, (_, i) => (
          <rect key={`k${i}`} x={i * 11.43 + 11.43 - 0.6} y="80" width="0.6" height="20" fill="#725c3a" opacity="0.35" />
        ))}
        {spec.pressed.map((i) => (
          <rect key={`p${i}`} x={i * 11.43} y="80" width="11.43" height="20" fill={light} opacity="0.9" />
        ))}
        {[0, 1, 3, 4, 5, 7, 8, 10, 11, 12].map((i) => (
          <rect key={`b${i}`} x={i * 11.43 + 7.8} y="80" width="7" height="12" rx="1" fill="#725c3a" />
        ))}
      </g>
      <text x="150" y="16" textAnchor="end" fontSize="13" fill="#725c3a" opacity="0.7" fontFamily="serif">
        {glyph}
      </text>
    </svg>
  );
}
