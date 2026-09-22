import Link from "next/link";

import { SITE_NAME, supportEmail, supportMailto } from "@/lib/site";

export default function AppFooter() {
  const email = supportEmail();
  const mailto = supportMailto();

  return (
    <footer className="site-footer" role="contentinfo">
      <p className="site-footer-brand">{SITE_NAME}</p>
      <nav className="site-footer-nav" aria-label="Legal y soporte">
        <Link href="/terms">Términos</Link>
        <Link href="/privacy">Privacidad</Link>
        <Link href="/refund">Reembolsos</Link>
        {mailto ? (
          <a href={mailto}>Contacto</a>
        ) : (
          <span className="site-footer-muted" title="Configura NEXT_PUBLIC_SUPPORT_EMAIL">
            Contacto (próximamente)
          </span>
        )}
      </nav>
      {email && <p className="site-footer-muted">{email}</p>}
    </footer>
  );
}
