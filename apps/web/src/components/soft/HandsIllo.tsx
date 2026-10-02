/**
 * Dos manos en línea posadas sobre un teclado: las barras caen por el carril
 * de cada dedo y, al llegar, la yema y la tecla se encienden (chai la
 * izquierda, matcha la derecha). Todo CSS: cada carril tiene su duración y
 * retardo, y la yema comparte el reloj de su barra.
 */

const W = 600;
const H = 360;
const WHITE = 14;
const KEY_W = W / WHITE;
const KEY_TOP = 250;
const MATCHA = "#809671";
const CHAI = "#d2ab80";
const BLACK_AFTER = new Set([0, 1, 3, 4, 5]);

type Finger = { key: number; tipY: number; len: number; w: number };
/** Dedos de una mano (pulgar → meñique) por tecla blanca relativa. */
const FINGERS: Finger[] = [
  { key: 0, tipY: 292, len: 60, w: 24 },
  { key: 1, tipY: 262, len: 96, w: 22 },
  { key: 2, tipY: 256, len: 104, w: 22 },
  { key: 3, tipY: 262, len: 96, w: 21 },
  { key: 4, tipY: 276, len: 78, w: 19 },
];

/** Reloj de cada carril: duración y retardo, alternando manos para que suene a melodía. */
const CLOCK = [
  [4.6, 0.0],
  [4.6, 1.9],
  [4.6, 0.8],
  [4.6, 3.1],
  [4.6, 2.3],
  [4.6, 0.4],
  [4.6, 1.3],
  [4.6, 3.6],
  [4.6, 2.7],
  [4.6, 1.6],
] as const;

function Hand({ firstKey, mirror, color }: { firstKey: number; mirror: boolean; color: string }) {
  // Para la mano derecha el pulgar queda a la izquierda; la izquierda se refleja.
  const fingers = FINGERS.map((f) => ({ ...f, key: mirror ? firstKey + (4 - f.key) : firstKey + f.key }));
  const xs = fingers.map((f) => (f.key + 0.5) * KEY_W);
  const minX = Math.min(...xs) - 18;
  const maxX = Math.max(...xs) + 18;
  return (
    <g className="hand">
      {/* palma */}
      <path
        d={`M${minX} 335 C ${minX - 6} 312, ${minX + 10} 300, ${minX + 26} 304 L ${maxX - 26} 304 C ${maxX - 10} 300, ${maxX + 6} 312, ${maxX} 335 L ${maxX} ${H + 10} L ${minX} ${H + 10} Z`}
        fill="rgba(255,253,248,0.94)"
        stroke="#725c3a"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {fingers.map((f, i) => {
        const x = (f.key + 0.5) * KEY_W;
        return (
          <g key={i}>
            <rect x={x - f.w / 2} y={f.tipY} width={f.w} height={f.len} rx={f.w / 2} fill="rgba(255,253,248,0.94)" stroke="#725c3a" strokeWidth="2" />
            {/* nudillo */}
            <path d={`M${x - 5} ${f.tipY + f.len * 0.48} q 5 -4 10 0`} stroke="#725c3a" strokeWidth="1.3" fill="none" opacity="0.6" />
          </g>
        );
      })}
      {fingers.map((f, i) => {
        const x = (f.key + 0.5) * KEY_W;
        const lane = mirror ? 4 - i : i;
        const [dur, delay] = CLOCK[(mirror ? 0 : 5) + lane];
        return (
          <circle
            key={`t${i}`}
            className="tip"
            cx={x}
            cy={f.tipY + 10}
            r="7.5"
            fill={color}
            style={{ animationDuration: `${dur}s`, animationDelay: `${delay}s` }}
          />
        );
      })}
    </g>
  );
}

export default function HandsIllo({ className = "" }: { className?: string }) {
  const lanes = [
    ...FINGERS.map((f, i) => ({ key: 1 + (4 - i), color: CHAI, clock: CLOCK[i] })),
    ...FINGERS.map((f, i) => ({ key: 8 + i, color: MATCHA, clock: CLOCK[5 + i] })),
  ];
  return (
    <svg className={`illo hands${className ? ` ${className}` : ""}`} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {/* teclado */}
      {Array.from({ length: WHITE }, (_, i) => (
        <rect key={`w${i}`} x={i * KEY_W + 0.5} y={KEY_TOP} width={KEY_W - 1} height={H - KEY_TOP} rx="3" fill="#fffdf8" stroke="#d8cdb9" />
      ))}
      {lanes.map((l, i) => (
        <rect
          key={`k${i}`}
          className="key-lit"
          x={l.key * KEY_W + 0.5}
          y={KEY_TOP}
          width={KEY_W - 1}
          height={H - KEY_TOP}
          rx="3"
          fill={l.color}
          style={{ animationDuration: `${l.clock[0]}s`, animationDelay: `${l.clock[1]}s` }}
        />
      ))}
      {Array.from({ length: WHITE - 1 }, (_, i) =>
        BLACK_AFTER.has(i % 7) ? (
          <rect key={`b${i}`} x={(i + 1) * KEY_W - KEY_W * 0.3} y={KEY_TOP} width={KEY_W * 0.6} height={(H - KEY_TOP) * 0.58} rx="2" fill="#725c3a" />
        ) : null,
      )}
      <line x1="0" y1={KEY_TOP} x2={W} y2={KEY_TOP} stroke="#b3b792" strokeWidth="3" />

      {/* barras que caen por el carril de cada dedo */}
      {lanes.map((l, i) => {
        const h = 46 + ((i * 37) % 40);
        return (
          <rect
            key={`f${i}`}
            className="fall"
            x={(l.key + 0.5) * KEY_W - 11}
            y={-h}
            width="22"
            height={h}
            rx="6"
            fill={l.color}
            style={{ ["--to" as string]: `${KEY_TOP}px`, animationDuration: `${l.clock[0]}s`, animationDelay: `${l.clock[1]}s` }}
          />
        );
      })}

      <Hand firstKey={1} mirror color={CHAI} />
      <Hand firstKey={8} mirror={false} color={MATCHA} />
    </svg>
  );
}
