/**
 * Ilustraciones de línea de Pianissimo (SVG inline, trazo carob). Pensadas
 * para animarse con CSS: `.draw` dibuja el trazo, `.float` flota suavemente.
 */

export function GrandPiano({ className = "" }: { className?: string }) {
  return (
    <svg className={`illo piano-line${className ? ` ${className}` : ""}`} viewBox="0 0 240 160" fill="none" aria-hidden="true">
      <g stroke="#725c3a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="draw">
        {/* tapa abierta */}
        <path d="M118 28 C 150 10, 200 12, 214 40 L 196 92 L 118 70 Z" />
        <path d="M118 28 L 118 70" />
        <path d="M150 40 L 196 92" />
        {/* cuerpo */}
        <path d="M28 70 L 118 70 L 196 92 L 196 120 L 28 120 Z" />
        <path d="M28 70 L 28 120" />
        {/* teclado */}
        <path d="M34 98 L 150 98 L 150 112 L 34 112 Z" />
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d={`M${42 + i * 9} 98 L ${42 + i * 9} 112`} strokeWidth="1.4" opacity="0.6" />
        ))}
        {/* patas */}
        <path d="M40 120 L 40 150" />
        <path d="M110 120 L 110 150" />
        <path d="M186 120 L 186 150" />
        {/* pedales */}
        <path d="M100 150 L 128 150" strokeWidth="3" />
      </g>
    </svg>
  );
}

export function CloudUpload({ className = "" }: { className?: string }) {
  return (
    <svg className={`illo cloud-upload${className ? ` ${className}` : ""}`} viewBox="0 0 240 200" fill="none" aria-hidden="true">
      <path
        className="float"
        d="M60 120 C 30 120, 24 82, 56 76 C 56 46, 100 34, 118 60 C 136 36, 186 44, 184 80 C 212 80, 220 118, 188 120 Z"
        fill="#eef0e6"
        stroke="#809671"
        strokeWidth="2"
      />
      <g className="rise" stroke="#809671" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M120 112 L 120 70" />
        <path d="M104 86 L 120 70 L 136 86" />
      </g>
      <g stroke="#725c3a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M70 150 L 70 132 L 160 126 L 160 150 Z" fill="#fffdf8" />
        <path d="M78 138 L 152 133 L 152 142 L 78 146 Z" fill="#f3ecdd" />
        {Array.from({ length: 10 }, (_, i) => (
          <path key={i} d={`M${84 + i * 7} 134 L ${84 + i * 7} 145`} strokeWidth="1.3" opacity="0.7" />
        ))}
        <path d="M76 150 L 76 168" />
        <path d="M156 150 L 156 168" />
        <path d="M118 150 L 118 168" />
      </g>
      <ellipse cx="118" cy="176" rx="60" ry="5" fill="#e5d2b8" opacity="0.6" />
    </svg>
  );
}

export function Sprout({ className = "" }: { className?: string }) {
  return (
    <svg className={`illo sprout${className ? ` ${className}` : ""}`} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M20 36 C 20 26, 20 22, 20 18" stroke="#809671" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 22 C 12 22, 8 16, 8 10 C 15 10, 20 14, 20 22 Z" fill="#b3b792" />
      <path d="M20 18 C 28 18, 32 12, 32 6 C 25 6, 20 10, 20 18 Z" fill="#809671" />
    </svg>
  );
}

export function TrebleClef({ className = "" }: { className?: string }) {
  return (
    <svg className={`illo clef${className ? ` ${className}` : ""}`} viewBox="0 0 40 90" fill="none" aria-hidden="true">
      <path
        d="M22 86 C 14 86, 12 76, 18 73 C 24 70, 28 78, 22 82 M20 72 L 14 30 C 12 16, 26 6, 26 18 C 26 28, 10 36, 10 52 C 10 64, 30 66, 30 54 C 30 44, 16 44, 16 54"
        stroke="#725c3a"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Cinta de pentagrama ondulada con notas, en tres tonos de la paleta. */
export function Ribbon({ tone = "m", className = "" }: { tone?: "m" | "p" | "c" | "v"; className?: string }) {
  const fill = tone === "m" ? "#b3b792" : tone === "p" ? "#dfe3cf" : tone === "c" ? "#d2ab80" : "#e5d2b8";
  return (
    <svg className={`illo ribbon${className ? ` ${className}` : ""}`} viewBox="0 0 120 420" fill="none" aria-hidden="true">
      <path
        d="M10 0 C 90 60, 90 120, 20 180 C -40 240, 40 300, 100 340 C 130 370, 110 400, 70 420 L 30 420 C 70 400, 90 376, 62 350 C 10 310, -50 250, 2 180 C 60 120, 60 70, -20 10 Z"
        fill={fill}
        opacity="0.9"
      />
      <g stroke="#725c3a" strokeWidth="1" opacity="0.45">
        {[0, 1, 2, 3, 4].map((i) => (
          <path key={i} d={`M${18 + i * 4} ${20 + i * 2} C ${80 + i * 3} ${70 + i * 2}, ${82 + i * 3} ${130}, ${16 + i * 4} ${190 + i * 2}`} />
        ))}
      </g>
      <g fill="#725c3a">
        <ellipse cx="46" cy="60" rx="5" ry="3.5" transform="rotate(-20 46 60)" />
        <path d="M50 58 L 50 34" stroke="#725c3a" strokeWidth="1.6" />
        <ellipse cx="62" cy="112" rx="5" ry="3.5" transform="rotate(-20 62 112)" />
        <path d="M66 110 L 66 86" stroke="#725c3a" strokeWidth="1.6" />
        <ellipse cx="40" cy="300" rx="5" ry="3.5" transform="rotate(-20 40 300)" />
        <path d="M44 298 L 44 274" stroke="#725c3a" strokeWidth="1.6" />
        <ellipse cx="78" cy="352" rx="5" ry="3.5" transform="rotate(-20 78 352)" />
        <path d="M82 350 L 82 326" stroke="#725c3a" strokeWidth="1.6" />
      </g>
    </svg>
  );
}
