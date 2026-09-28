import Link from "next/link";

import { SITE_NAME, supportMailto } from "@/lib/site";

export default function AppFooter() {
  const mailto = supportMailto();
  const year = new Date().getFullYear();

  return (
    <footer className="footer" role="contentinfo">
      <span>
        © {year} {SITE_NAME} · Hecho para practicar piano
      </span>
      <nav aria-label="Legal y soporte">
        <Link href="/terms">Términos</Link>
        <Link href="/privacy">Privacidad</Link>
        <Link href="/refund">Reembolsos</Link>
        {mailto && <a href={mailto}>Contacto</a>}
      </nav>
    </footer>
  );
}
