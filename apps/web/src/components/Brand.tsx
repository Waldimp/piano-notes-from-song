import Link from "next/link";

import { SITE_NAME } from "@/lib/site";

/** Marca gráfica: cinco teclas con una dorada (la nota que cae). */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="8" fill="#1c1713" />
      <rect x="5" y="14" width="4.2" height="13" rx="1.2" fill="#f4ede3" />
      <rect x="10.4" y="14" width="4.2" height="13" rx="1.2" fill="#f4ede3" />
      <rect x="15.8" y="14" width="4.2" height="13" rx="1.2" fill="#e8b45a" />
      <rect x="21.2" y="14" width="4.2" height="13" rx="1.2" fill="#f4ede3" />
      <rect x="26.6" y="14" width="0.4" height="13" fill="#f4ede3" opacity="0.4" />
      <rect x="15.8" y="4" width="4.2" height="8" rx="1.2" fill="#f6d28c" />
      <rect x="8.2" y="14" width="2.4" height="8" rx="0.8" fill="#100d0b" />
      <rect x="19" y="14" width="2.4" height="8" rx="0.8" fill="#100d0b" />
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
