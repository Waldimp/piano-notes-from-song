/**
 * Dos manos posadas sobre un teclado, vistas desde arriba: las barras caen por
 * el carril de cada dedo y, al llegar, el dedo presiona (baja un poco hacia la
 * palma), la yema y la tecla se encienden (chai la izquierda, matcha la
 * derecha). Cada dedo es una pieza independiente que se mueve sola; la palma
 * se dibuja encima de las bases de los dedos (misma piel, sin trazo) para
 * esconder lo que sobra, y los trazos fijos (bordes de la palma y membranas)
 * van al final. Todo CSS: cada carril tiene su duración y retardo, y el dedo,
 * la yema y la tecla comparten reloj.
 */

const W = 600;
const H = 400;
const WHITE = 14;
const S = W / WHITE; // ancho de tecla blanca
const KEY_TOP = 228;
const MATCHA = "#809671";
const CHAI = "#d2ab80";
const INK = "#725c3a";
const SKIN = "#f5ebdd";
const BLACK_AFTER = new Set([0, 1, 3, 4, 5]);
/** Cuánto baja un dedo al presionar (px). */
const PRESS = 8;

/** Dedos índice → meñique en el espacio local de la mano (x = 0 es el pulgar). */
type Finger = { cx: number; tip: number; hw: number };
const FINGERS: Finger[] = [
  { cx: S * 1, tip: 250, hw: 15.5 },
  { cx: S * 2, tip: 239, hw: 15.5 },
  { cx: S * 3, tip: 247, hw: 14.5 },
  { cx: S * 4, tip: 268, hw: 13 },
];
/** Pulgar: centro del arco de la punta, radio y cuánto se abre hacia afuera (grados). */
const THUMB = { cx: -16, tipY: 308, r: 15, tilt: 30 };
/** Posición (sobre el eje del pulgar) donde la palma lo tapa y nace la membrana. */
const A_CROSS = -30;
const TH_RAD = (THUMB.tilt * Math.PI) / 180;
/** Eje del pulgar (de la base a la punta) y su perpendicular (hacia el índice). */
const TH_D = { x: -Math.sin(TH_RAD), y: -Math.cos(TH_RAD) };
const TH_N = { x: Math.cos(TH_RAD), y: -Math.sin(TH_RAD) };
const thPt = (a: number, b: number) => ({ x: THUMB.cx + TH_D.x * a + TH_N.x * b, y: THUMB.tipY + TH_D.y * a + TH_N.y * b });
/** Valles entre dedos (índice·medio, medio·anular, anular·meñique). */
const VALLEYS = [354, 350, 358];
/** Horcadura pulgar·índice y base exterior del meñique. */
const CROTCH_Y = 352;
const PINKY_BASE = 352;

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

const n1 = (v: number) => v.toFixed(1);
const pt = (p: { x: number; y: number }) => `${n1(p.x)} ${n1(p.y)}`;

type Piece = {
  path: string;
  creases: string[];
  nail: { cx: number; cy: number; rx: number; ry: number; rot: number };
  tip: { x: number; y: number };
  press: { x: number; y: number };
};

/** Un dedo recto: cápsula con leve estrechamiento hacia la yema; la base queda bajo la palma. */
function straightFinger(f: Finger, baseL: number, baseR: number): Piece {
  const tipHw = f.hw * 0.9;
  const l = f.cx - f.hw;
  const r = f.cx + f.hw;
  const bottom = Math.max(baseL, baseR) + f.hw * 1.3;
  const path = [
    `M ${n1(l)} ${n1(baseL)}`,
    `C ${n1(l)} ${n1(baseL - 30)}, ${n1(f.cx - tipHw)} ${n1(f.tip + 40)}, ${n1(f.cx - tipHw)} ${n1(f.tip + tipHw)}`,
    `C ${n1(f.cx - tipHw)} ${n1(f.tip + tipHw * 0.42)}, ${n1(f.cx - tipHw * 0.55)} ${n1(f.tip)}, ${n1(f.cx)} ${n1(f.tip)}`,
    `C ${n1(f.cx + tipHw * 0.55)} ${n1(f.tip)}, ${n1(f.cx + tipHw)} ${n1(f.tip + tipHw * 0.42)}, ${n1(f.cx + tipHw)} ${n1(f.tip + tipHw)}`,
    `C ${n1(f.cx + tipHw)} ${n1(f.tip + 40)}, ${n1(r)} ${n1(baseR - 30)}, ${n1(r)} ${n1(baseR)}`,
    `C ${n1(r)} ${n1(bottom)}, ${n1(l)} ${n1(bottom)}, ${n1(l)} ${n1(baseL)}`,
    "Z",
  ].join(" ");
  const creases = [0.33, 0.62].map((k, j) => {
    const y = f.tip + 13 + (VALLEYS[0] - 24 - f.tip - 13) * k;
    const ww = f.hw * 1.1 * (j === 0 ? 0.78 : 0.9);
    return `M ${n1(f.cx - ww / 2)} ${n1(y)} q ${n1(ww / 2)} -4.5 ${n1(ww)} 0`;
  });
  return {
    path,
    creases,
    nail: { cx: f.cx, cy: f.tip + 9.5, rx: f.hw * 0.5, ry: 6.5, rot: 0 },
    tip: { x: f.cx, y: f.tip + 13 },
    press: { x: 0, y: PRESS },
  };
}

/** El pulgar: cápsula inclinada sobre su eje; su base también queda bajo la palma. */
function thumb(): Piece {
  const t = THUMB;
  const k = t.r * 0.56;
  const path = [
    `M ${pt(thPt(-64, -t.r))}`,
    `L ${pt(thPt(-4, -t.r))}`,
    `C ${pt(thPt(k - 4, -t.r))}, ${pt(thPt(t.r, -k))}, ${pt(thPt(t.r, 0))}`,
    `C ${pt(thPt(t.r, k))}, ${pt(thPt(k - 4, t.r))}, ${pt(thPt(-4, t.r))}`,
    `L ${pt(thPt(-64, t.r))}`,
    "Z",
  ].join(" ");
  const nailC = thPt(t.r - 9.5, 0);
  return {
    path,
    creases: [],
    nail: { cx: nailC.x, cy: nailC.y, rx: t.r * 0.5, ry: 6, rot: -t.tilt },
    tip: thPt(-2, 0),
    press: { x: -TH_D.x * PRESS, y: -TH_D.y * PRESS },
  };
}

/** Piezas en orden de carril: pulgar, índice, medio, anular, meñique. */
const PIECES: Piece[] = [
  thumb(),
  straightFinger(FINGERS[0], CROTCH_Y, VALLEYS[0]),
  straightFinger(FINGERS[1], VALLEYS[0], VALLEYS[1]),
  straightFinger(FINGERS[2], VALLEYS[1], VALLEYS[2]),
  straightFinger(FINGERS[3], VALLEYS[2], PINKY_BASE),
];

const crotchX = FINGERS[0].cx - FINGERS[0].hw;
const pinkyR = FINGERS[3].cx + FINGERS[3].hw;
const WRIST_L = { x: -22, y: H + 24 };
const WRIST_R = { x: pinkyR + 10, y: H + 24 };

/** Palma (misma piel, sin trazo): tapa las bases de los dedos sin tocar sus bordes visibles. */
function palmCover(): string {
  const r = THUMB.r;
  const o = 1; // sale 1 px por fuera de cada borde: el trazo fijo lo tapa después
  const d: string[] = [`M ${pt(WRIST_L)}`];
  d.push(`C -24 400, ${pt(thPt(A_CROSS - 14, -r - o))}, ${pt(thPt(A_CROSS, -r - o))}`);
  d.push(`L ${pt(thPt(A_CROSS, r + o))}`);
  d.push(`C ${pt(thPt(A_CROSS - 12, r + o))}, ${n1(crotchX - 1)} 344, ${n1(crotchX + o)} ${n1(CROTCH_Y + o)}`);
  FINGERS.forEach((f, i) => {
    const next = FINGERS[i + 1];
    const rightBase = next ? VALLEYS[i] : PINKY_BASE;
    d.push(`L ${n1(f.cx + f.hw + o)} ${n1(rightBase - 10)}`);
    if (next) {
      const v = VALLEYS[i];
      d.push(`C ${n1(f.cx + f.hw + o)} ${n1(v)}, ${n1(next.cx - next.hw - o)} ${n1(v)}, ${n1(next.cx - next.hw - o)} ${n1(v - 10)}`);
    }
  });
  d.push(`C ${n1(pinkyR + 6 + o)} 380, ${n1(pinkyR + 12 + o)} 402, ${n1(WRIST_R.x + o)} ${n1(WRIST_R.y)}`);
  d.push("Z");
  return d.join(" ");
}

/** Trazos fijos: bordes de la palma y membranas entre dedos. */
function palmStrokes(): string[] {
  const r = THUMB.r;
  const out: string[] = [];
  out.push(`M ${pt(WRIST_L)} C -24 400, ${pt(thPt(A_CROSS - 14, -r))}, ${pt(thPt(A_CROSS, -r))}`);
  out.push(`M ${pt(thPt(A_CROSS, r))} C ${pt(thPt(A_CROSS - 12, r))}, ${n1(crotchX - 2)} 343, ${n1(crotchX)} ${n1(CROTCH_Y)}`);
  FINGERS.forEach((f, i) => {
    const next = FINGERS[i + 1];
    if (!next) return;
    const v = VALLEYS[i];
    out.push(`M ${n1(f.cx + f.hw)} ${n1(v - 10)} C ${n1(f.cx + f.hw)} ${n1(v - 1)}, ${n1(next.cx - next.hw)} ${n1(v - 1)}, ${n1(next.cx - next.hw)} ${n1(v - 10)}`);
  });
  out.push(`M ${n1(pinkyR)} ${n1(PINKY_BASE - 10)} L ${n1(pinkyR)} ${n1(PINKY_BASE)} C ${n1(pinkyR + 6)} 380, ${n1(pinkyR + 12)} 402, ${pt(WRIST_R)}`);
  return out;
}

/** Silueta completa, solo para la sombra. */
function shadowOutline(): string {
  const r = THUMB.r;
  const k = r * 0.56;
  const d: string[] = [`M ${pt(WRIST_L)}`];
  d.push(`C -24 400, ${pt(thPt(-40, -r))}, ${pt(thPt(-4, -r))}`);
  d.push(`C ${pt(thPt(k - 4, -r))}, ${pt(thPt(r, -k))}, ${pt(thPt(r, 0))}`);
  d.push(`C ${pt(thPt(r, k))}, ${pt(thPt(k - 4, r))}, ${pt(thPt(-4, r))}`);
  d.push(`C ${pt(thPt(-42, r))}, ${n1(crotchX - 2)} 343, ${n1(crotchX)} ${n1(CROTCH_Y)}`);
  FINGERS.forEach((f, i) => {
    const tipHw = f.hw * 0.9;
    const base = i === 0 ? CROTCH_Y : VALLEYS[i - 1];
    d.push(`C ${n1(f.cx - f.hw)} ${n1(base - 30)}, ${n1(f.cx - tipHw)} ${n1(f.tip + 40)}, ${n1(f.cx - tipHw)} ${n1(f.tip + tipHw)}`);
    d.push(`C ${n1(f.cx - tipHw)} ${n1(f.tip + tipHw * 0.42)}, ${n1(f.cx - tipHw * 0.55)} ${n1(f.tip)}, ${n1(f.cx)} ${n1(f.tip)}`);
    d.push(`C ${n1(f.cx + tipHw * 0.55)} ${n1(f.tip)}, ${n1(f.cx + tipHw)} ${n1(f.tip + tipHw * 0.42)}, ${n1(f.cx + tipHw)} ${n1(f.tip + tipHw)}`);
    const next = FINGERS[i + 1];
    if (next) {
      const v = VALLEYS[i];
      d.push(`C ${n1(f.cx + tipHw)} ${n1(f.tip + 40)}, ${n1(f.cx + f.hw)} ${n1(v - 30)}, ${n1(f.cx + f.hw)} ${n1(v - 10)}`);
      d.push(`C ${n1(f.cx + f.hw)} ${n1(v - 1)}, ${n1(next.cx - next.hw)} ${n1(v - 1)}, ${n1(next.cx - next.hw)} ${n1(v - 10)}`);
    } else {
      d.push(`C ${n1(f.cx + tipHw)} ${n1(f.tip + 40)}, ${n1(f.cx + f.hw)} 330, ${n1(f.cx + f.hw)} ${n1(PINKY_BASE)}`);
    }
  });
  d.push(`C ${n1(pinkyR + 6)} 380, ${n1(pinkyR + 12)} 402, ${pt(WRIST_R)}`);
  d.push("Z");
  return d.join(" ");
}

const COVER = palmCover();
const STROKES = palmStrokes();
const SHADOW = shadowOutline();

function Hand({ firstKey, mirror, color }: { firstKey: number; mirror: boolean; color: string }) {
  // mano derecha: el pulgar queda en firstKey y los dedos hacia la derecha;
  // la izquierda se refleja, así el pulgar cae en la tecla más alta del tramo.
  const originX = mirror ? (firstKey + 4.5) * S : (firstKey + 0.5) * S;
  const transform = mirror ? `translate(${n1(originX)} 0) scale(-1 1)` : `translate(${n1(originX)} 0)`;
  return (
    <g className="hand" transform={transform}>
      <path d={SHADOW} fill={INK} opacity="0.16" filter="url(#hand-shadow)" transform="translate(4 10)" />
      {PIECES.map((pc, i) => {
        const lane = mirror ? 4 - i : i;
        const [dur, delay] = CLOCK[(mirror ? 0 : 5) + lane];
        const timing = { animationDuration: `${dur}s`, animationDelay: `${delay}s` };
        return (
          <g key={i} className="finger" style={{ ["--px" as string]: `${n1(pc.press.x)}px`, ["--py" as string]: `${n1(pc.press.y)}px`, ...timing }}>
            <path d={pc.path} fill={SKIN} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
            {pc.creases.map((c, j) => (
              <path key={j} d={c} stroke={INK} strokeWidth="1.2" fill="none" opacity="0.38" strokeLinecap="round" />
            ))}
            <ellipse
              cx={n1(pc.nail.cx)}
              cy={n1(pc.nail.cy)}
              rx={n1(pc.nail.rx)}
              ry={n1(pc.nail.ry)}
              transform={pc.nail.rot ? `rotate(${pc.nail.rot} ${n1(pc.nail.cx)} ${n1(pc.nail.cy)})` : undefined}
              fill="#fbf7f0"
              stroke={INK}
              strokeWidth="1.1"
              opacity="0.55"
            />
            <circle className="tip" cx={n1(pc.tip.x)} cy={n1(pc.tip.y)} r="8" fill={color} style={timing} />
          </g>
        );
      })}
      <path d={COVER} fill={SKIN} />
      {STROKES.map((s, i) => (
        <path key={`s${i}`} d={s} fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </g>
  );
}

export default function HandsIllo({ className = "" }: { className?: string }) {
  const lanes = [
    ...FINGERS.map((_, i) => ({ key: 1 + (3 - i), color: CHAI, clock: CLOCK[i] })),
    { key: 5, color: CHAI, clock: CLOCK[4] },
    { key: 8, color: MATCHA, clock: CLOCK[5] },
    ...FINGERS.map((_, i) => ({ key: 9 + i, color: MATCHA, clock: CLOCK[6 + i] })),
  ];
  return (
    <svg className={`illo hands${className ? ` ${className}` : ""}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <defs>
        <filter id="hand-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      {/* teclado */}
      {Array.from({ length: WHITE }, (_, i) => (
        <rect key={`w${i}`} x={i * S + 0.5} y={KEY_TOP} width={S - 1} height={H - KEY_TOP} rx="3" fill="#fffdf8" stroke="#d8cdb9" />
      ))}
      {lanes.map((l, i) => (
        <rect
          key={`k${i}`}
          className="key-lit"
          x={l.key * S + 0.5}
          y={KEY_TOP}
          width={S - 1}
          height={H - KEY_TOP}
          rx="3"
          fill={l.color}
          style={{ animationDuration: `${l.clock[0]}s`, animationDelay: `${l.clock[1]}s` }}
        />
      ))}
      {Array.from({ length: WHITE - 1 }, (_, i) =>
        BLACK_AFTER.has(i % 7) ? (
          <rect key={`b${i}`} x={(i + 1) * S - S * 0.3} y={KEY_TOP} width={S * 0.6} height={(H - KEY_TOP) * 0.5} rx="2" fill={INK} />
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
            x={(l.key + 0.5) * S - 11}
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
