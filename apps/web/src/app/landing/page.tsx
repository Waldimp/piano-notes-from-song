import Link from "next/link";

import AppFooter from "@/components/AppFooter";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export default function LandingPage() {
  return (
    <main className="landing">
      <header className="landing-hero">
        <p className="landing-kicker">{SITE_NAME}</p>
        <h1>{SITE_TAGLINE}</h1>
        <p className="landing-lead">{SITE_DESCRIPTION}</p>
        <div className="landing-cta">
          <Link className="btn active" href="/login">
            Probar gratis
          </Link>
          <Link className="btn" href="/pricing">
            Ver precios
          </Link>
        </div>
      </header>

      <section className="landing-section" aria-labelledby="how-title">
        <h2 id="how-title">Qué hace Pianissimo</h2>
        <ul className="landing-features">
          <li>
            <strong>Sube tu canción</strong> — audio de piano en formatos habituales.
          </li>
          <li>
            <strong>Transcripción con IA</strong> — convertimos el audio en notas de piano.
          </li>
          <li>
            <strong>Tutorial interactivo</strong> — notas que caen para aprender y practicar.
          </li>
        </ul>
        <p className="subtitle">
          Los resultados dependen de la calidad del audio; no prometemos precisión perfecta en
          cada grabación.
        </p>
      </section>

      <section className="landing-section landing-pricing-teaser" aria-labelledby="plans-title">
        <h2 id="plans-title">Planes</h2>
        <ul className="landing-plans">
          <li>
            <strong>Free</strong> — 3 tutoriales, hasta 60 s, $0
          </li>
          <li>
            <strong>Mini Pack</strong> — 5 tutoriales, pago único $2.99
          </li>
          <li>
            <strong>Practice / Plus</strong> — suscripción mensual, próximamente
          </li>
        </ul>
        <Link href="/pricing" className="btn small">
          Detalle de precios
        </Link>
      </section>

      <AppFooter />
    </main>
  );
}
