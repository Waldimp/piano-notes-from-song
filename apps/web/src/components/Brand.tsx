import Link from "next/link";

import Logo from "@/components/soft/Logo";
import { SITE_NAME } from "@/lib/site";

/** Marca gráfica: el logo oficial (piano de cola a pincel), limpio, sin fondo. */
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <Logo />
    </span>
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
