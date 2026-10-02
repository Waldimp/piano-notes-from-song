import Link from "next/link";

import { SITE_NAME } from "@/lib/site";

/** Marca gráfica: piano de cola en línea, trazo carob, con una nota matcha. */
export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false">
      <circle cx="20" cy="20" r="19" fill="#e9ecdc" />
      <g stroke="#725c3a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 12 C 25 9, 31 10, 32 15 L 29 23 L 20 20 Z" />
        <path d="M8 20 L 20 20 L 29 23 L 29 27 L 8 27 Z" />
        <path d="M10 27 L 10 31 M19 27 L 19 31 M27 27 L 27 31" />
      </g>
      <circle cx="13" cy="12" r="2.6" fill="#809671" />
      <path d="M15.4 12 L 15.4 5.5" stroke="#809671" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export default function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label={SITE_NAME}>
      <BrandMark />
      <span>{SITE_NAME}</span>
    </Link>
  );
}
