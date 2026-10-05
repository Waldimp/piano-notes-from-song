/**
 * Dos manos posadas sobre un teclado, vistas desde arriba: las barras caen por
 * el carril de cada dedo y, al llegar, la yema y la tecla se encienden (chai la
 * izquierda, matcha la derecha). Cada mano es una sola silueta cerrada (pulgar
 * incluido) con pliegues de nudillos y una sombra suave sobre las teclas; la
 * muñeca sale por el borde inferior. Todo CSS: cada carril tiene su duración y
 * retardo, y la yema comparte el reloj de su barra.
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

/** Dedos índice → meñique en el espacio local de la mano (x = 0 es el pulgar). */
type Finger = { cx: number; tip: number; hw: number };
const FINGERS: Finger[] = [
  { cx: S * 1, tip: 250, hw: 15.5 },
  { cx: S * 2, tip: 239, hw: 15.5 },
  { cx: S * 3, tip: 247, hw: 14.5 },
  { cx: S * 4, tip: 268, hw: 13 },
];
/** Pulgar: centro del arco de la punta, radio y cuánto se abre hacia afuera (grados). */
const THUMB = { cx: -8, tipY: 314, r: 13.5, tilt: 24 };
const TH_RAD = (THUMB.tilt * Math.PI) / 180;
/** Eje del pulgar (de la base a la punta) y su perpendicular (hacia el índice). */
const TH_D = { x: -Math.sin(TH_RAD), y: -Math.cos(TH_RAD) };
const TH_N = { x: Math.cos(TH_RAD), y: -Math.sin(TH_RAD) };
const thPt = (a: number, b: number) => ({ x: THUMB.cx + TH_D.x * a + TH_N.x * b, y: THUMB.tipY + TH_D.y * a + TH_N.y * b });
/** Valles entre dedos (índice·medio, medio·anular, anular·meñique). */
const VALLEYS = [354, 350, 358];
/** Donde posa la yema de cada carril (pulgar + 4 dedos). */
const THUMB_PAD = thPt(-2, 0);
const TIPS = [THUMB_PAD, ...FINGERS.map((f) => ({ x: f.cx, y: f.tip + 13 }))];

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

/** Silueta de una mano derecha (pulgar a la izquierda), de la muñeca a la muñeca. */
function handOutline(): string {
  const t = THUMB;
  const f0 = FINGERS[0];
  const f3 = FINGERS[3];
  const d: string[] = [];
  // muñeca, lado del pulgar
  d.push(`M ${n1(-22)} ${H + 24}`);
  // borde exterior del pulgar (inclinado hacia afuera) hasta su punta
  const k = t.r * 0.56; // control de los arcos
  const O = thPt(-4, -t.r); // lado exterior, justo bajo el arco de la punta
  const Oc = thPt(-30, -t.r - 2);
  const A = thPt(t.r, 0); // ápice
  const I = thPt(-4, t.r); // lado interior
  const Ic = thPt(-30, t.r);
  d.push(`C ${n1(-28)} ${n1(392)}, ${n1(Oc.x)} ${n1(Oc.y)}, ${n1(O.x)} ${n1(O.y)}`);
  const c1 = thPt(k - 4, -t.r);
  const c2 = thPt(t.r, -k);
  d.push(`C ${n1(c1.x)} ${n1(c1.y)}, ${n1(c2.x)} ${n1(c2.y)}, ${n1(A.x)} ${n1(A.y)}`);
  const c3 = thPt(t.r, k);
  const c4 = thPt(k - 4, t.r);
  d.push(`C ${n1(c3.x)} ${n1(c3.y)}, ${n1(c4.x)} ${n1(c4.y)}, ${n1(I.x)} ${n1(I.y)}`);
  // borde interior del pulgar hasta la horcadura con el índice
  const crotchX = f0.cx - f0.hw;
  d.push(`C ${n1(Ic.x)} ${n1(Ic.y)}, ${n1(crotchX - 12)} ${n1(366)}, ${n1(crotchX)} ${n1(378)}`);
  // cuatro dedos
  FINGERS.forEach((f, i) => {
    const tipHw = f.hw * 0.9;
    const l = f.cx - f.hw;
    const r = f.cx + f.hw;
    const base = i === 0 ? 378 : VALLEYS[i - 1];
    // lado izquierdo, con leve estrechamiento hacia la punta
    d.push(`C ${n1(l)} ${n1(base - 30)}, ${n1(f.cx - tipHw)} ${n1(f.tip + 40)}, ${n1(f.cx - tipHw)} ${n1(f.tip + tipHw)}`);
    // yema
    d.push(`C ${n1(f.cx - tipHw)} ${n1(f.tip + tipHw * 0.42)}, ${n1(f.cx - tipHw * 0.55)} ${n1(f.tip)}, ${n1(f.cx)} ${n1(f.tip)}`);
    d.push(`C ${n1(f.cx + tipHw * 0.55)} ${n1(f.tip)}, ${n1(f.cx + tipHw)} ${n1(f.tip + tipHw * 0.42)}, ${n1(f.cx + tipHw)} ${n1(f.tip + tipHw)}`);
    // lado derecho hasta el valle con el siguiente dedo
    const next = FINGERS[i + 1];
    if (next) {
      const v = VALLEYS[i];
      d.push(`C ${n1(f.cx + tipHw)} ${n1(f.tip + 40)}, ${n1(r)} ${n1(v - 30)}, ${n1(r)} ${n1(v - 10)}`);
      d.push(`C ${n1(r)} ${n1(v - 1)}, ${n1(next.cx - next.hw)} ${n1(v - 1)}, ${n1(next.cx - next.hw)} ${n1(v - 10)}`);
    } else {
      d.push(`C ${n1(f.cx + tipHw)} ${n1(f.tip + 40)}, ${n1(r)} ${n1(330)}, ${n1(r)} ${n1(352)}`);
    }
  });
  // borde exterior de la palma (lado del meñique) hasta la muñeca
  const pr = f3.cx + f3.hw;
  d.push(`C ${n1(pr + 6)} ${n1(380)}, ${n1(pr + 12)} ${n1(402)}, ${n1(pr + 10)} ${H + 24}`);
  d.push("Z");
  return d.join(" ");
}

const OUTLINE = handOutline();

/** Pliegues de nudillos: dos por dedo y uno en el pulgar. */
function creases(): string[] {
  const out: string[] = [];
  FINGERS.forEach((f) => {
    const w = f.hw * 1.1;
    [0.33, 0.62].forEach((k, j) => {
      const y = f.tip + 13 + (VALLEYS[0] - 24 - f.tip - 13) * k;
      const ww = w * (j === 0 ? 0.78 : 0.9);
      out.push(`M ${n1(f.cx - ww / 2)} ${n1(y)} q ${n1(ww / 2)} ${n1(-4.5)} ${n1(ww)} 0`);
    });
  });
  const a = thPt(-36, -8);
  const b = thPt(-33, 9);
  const m = thPt(-30, 0);
  out.push(`M ${n1(a.x)} ${n1(a.y)} Q ${n1(m.x)} ${n1(m.y)} ${n1(b.x)} ${n1(b.y)}`);
  return out;
}
const CREASES = creases();

/** Uñas: elipses finas en cada yema; la del pulgar va girada con el dedo. */
type Nail = { cx: number; cy: number; rx: number; ry: number; rot: number };
const NAILS: Nail[] = [
  ...FINGERS.map((f) => ({ cx: f.cx, cy: f.tip + 9.5, rx: f.hw * 0.5, ry: 6.5, rot: 0 })),
  (() => {
    const c = thPt(THUMB.r - 9.5, 0);
    return { cx: c.x, cy: c.y, rx: THUMB.r * 0.5, ry: 6, rot: -THUMB.tilt };
  })(),
];

function Hand({ firstKey, mirror, color }: { firstKey: number; mirror: boolean; color: string }) {
  // mano derecha: el pulgar queda en firstKey y los dedos hacia la derecha;
  // la izquierda se refleja, así el pulgar cae en la tecla más alta del tramo.
  const originX = mirror ? (firstKey + 4.5) * S : (firstKey + 0.5) * S;
  const transform = mirror ? `translate(${n1(originX)} 0) scale(-1 1)` : `translate(${n1(originX)} 0)`;
  return (
    <g className="hand" transform={transform}>
      <path d={OUTLINE} fill={INK} opacity="0.16" filter="url(#hand-shadow)" transform="translate(4 10)" />
      <path d={OUTLINE} fill={SKIN} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      {CREASES.map((c, i) => (
        <path key={i} d={c} stroke={INK} strokeWidth="1.2" fill="none" opacity="0.38" strokeLinecap="round" />
      ))}
      {NAILS.map((nl, i) => (
        <ellipse
          key={`n${i}`}
          cx={n1(nl.cx)}
          cy={n1(nl.cy)}
          rx={n1(nl.rx)}
          ry={n1(nl.ry)}
          transform={nl.rot ? `rotate(${nl.rot} ${n1(nl.cx)} ${n1(nl.cy)})` : undefined}
          fill="#fbf7f0"
          stroke={INK}
          strokeWidth="1.1"
          opacity="0.55"
        />
      ))}
      {TIPS.map((tp, i) => {
        const lane = mirror ? 4 - i : i;
        const [dur, delay] = CLOCK[(mirror ? 0 : 5) + lane];
        return (
          <circle key={`t${i}`} className="tip" cx={n1(tp.x)} cy={n1(tp.y)} r="8" fill={color} style={{ animationDuration: `${dur}s`, animationDelay: `${delay}s` }} />
        );
      })}
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
