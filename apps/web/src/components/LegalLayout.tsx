import type { ReactNode } from "react";
import Link from "next/link";

import AppFooter from "@/components/AppFooter";
import Brand from "@/components/Brand";

export default function LegalLayout({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="shell narrow">
      <header className="nav" style={{ position: "static", background: "transparent", border: "none" }}>
        <div className="nav-inner" style={{ padding: 0 }}>
          <Brand href="/landing" />
          <div className="nav-spacer" />
          <Link className="btn small ghost" href="/">
            Tus canciones
          </Link>
        </div>
      </header>
      <article className="prose" style={{ marginTop: "2rem" }}>
        <p className="eyebrow">Legal</p>
        <h1>{title}</h1>
        <p className="updated">Última actualización: {updated} · Pianissimo</p>
        {children}
        <p style={{ marginTop: "2rem" }} className="muted small">
          <Link href="/terms">Términos</Link> · <Link href="/privacy">Privacidad</Link> ·{" "}
          <Link href="/refund">Reembolsos</Link>
        </p>
      </article>
      <AppFooter />
    </main>
  );
}
