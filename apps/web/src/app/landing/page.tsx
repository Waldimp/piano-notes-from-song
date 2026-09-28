import Link from "next/link";

import AppFooter from "@/components/AppFooter";
import Brand from "@/components/Brand";
import { BILLING_PRODUCTS } from "@/lib/billing/catalog";
import { FREE_CREDITS, FREE_PREVIEW_SECONDS } from "@/lib/beta/preview";

const NOTES: Array<{ left: number; h: number; d: number; delay: number; l?: boolean }> = [
  { left: 8, h: 22, d: 6.5, delay: 0 },
  { left: 22, h: 12, d: 6.5, delay: 1.2, l: true },
  { left: 36, h: 30, d: 6.5, delay: 2.4 },
  { left: 50, h: 16, d: 6.5, delay: 0.6 },
  { left: 64, h: 26, d: 6.5, delay: 3.1, l: true },
  { left: 78, h: 14, d: 6.5, delay: 1.9 },
  { left: 29, h: 10, d: 6.5, delay: 4.4 },
  { left: 71, h: 20, d: 6.5, delay: 5.2, l: true },
];

const KEYS = "wbwbwwbwbwbwww";

export default function LandingPage() {
  const mini = BILLING_PRODUCTS.mini_pack;
  return (
    <main className="shell">
      <header className="nav" style={{ position: "static", background: "transparent", border: "none" }}>
        <div className="nav-inner" style={{ padding: 0 }}>
          <Brand href="/landing" />
          <div className="nav-spacer" />
          <Link className="btn ghost small" href="/pricing">
            Precios
          </Link>
          <Link className="btn small" href="/login">
            Entrar
          </Link>
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">Tutoriales de piano con IA</p>
          <h1>
            Sube una canción. <em>Aprende a tocarla.</em>
          </h1>
          <p className="hero-lead">
            Pianissimo escucha un audio de piano, detecta cada nota y la convierte en un tutorial de notas
            que caen sobre un teclado de 88 teclas. Baja la velocidad, repite en loop y practica a tu ritmo.
          </p>
          <div className="hero-cta">
            <Link className="btn primary lg" href="/login">
              Probar gratis
            </Link>
            <Link className="btn lg" href="/pricing">
              Ver planes
            </Link>
          </div>
          <p className="hero-fine">
            Gratis: {FREE_CREDITS} tutoriales de vista previa ({FREE_PREVIEW_SECONDS} s cada uno). Sin tarjeta.
          </p>
        </div>
        <div className="mini-stage" aria-hidden="true">
          <div className="mini-notes">
            {NOTES.map((n, i) => (
              <span
                key={i}
                className={`mini-note${n.l ? " l" : ""}`}
                style={{
                  left: `${n.left}%`,
                  ["--h" as string]: `${n.h}%`,
                  ["--d" as string]: `${n.d}s`,
                  ["--delay" as string]: `${n.delay}s`,
                }}
              />
            ))}
          </div>
          <div className="mini-keys">
            {KEYS.split("").map((k, i) => (
              <span
                key={i}
                className={`mini-key${k === "b" ? " black" : ""}${i === 2 ? " hit" : ""}${i === 9 ? " black hit-b" : ""}`}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="how">
        <div className="section-head">
          <p className="eyebrow">Cómo funciona</p>
          <h2 id="how">De un audio a un tutorial en un minuto</h2>
        </div>
        <div className="steps">
          <div className="card step">
            <span className="step-n">1</span>
            <h3>Sube tu grabación</h3>
            <p>MP3, WAV, M4A, FLAC u OGG. Sirve una grabación de estudio o un cover que te guste.</p>
          </div>
          <div className="card step">
            <span className="step-n">2</span>
            <h3>La IA transcribe</h3>
            <p>Detectamos cada nota, su duración, la velocidad y el pedal con un modelo especializado en piano.</p>
          </div>
          <div className="card step">
            <span className="step-n">3</span>
            <h3>Practica a tu ritmo</h3>
            <p>Notas que caen, manos separadas por color, velocidad 0.5x–1.25x y loop A/B para las partes difíciles.</p>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="plans">
        <div className="section-head">
          <p className="eyebrow">Planes</p>
          <h2 id="plans">Empieza gratis, paga solo por lo que practicas</h2>
          <p>Cada tutorial completo consume un crédito. Reproducir los que ya tienes es siempre gratis.</p>
        </div>
        <div className="plans">
          <article className="card plan">
            <p className="eyebrow">Gratis</p>
            <h3>Prueba</h3>
            <p className="plan-price">$0</p>
            <p className="plan-tag">Para conocer Pianissimo</p>
            <ul>
              <li>{FREE_CREDITS} tutoriales de vista previa</li>
              <li>Primeros {FREE_PREVIEW_SECONDS} s de cualquier canción</li>
              <li>Todas las herramientas de práctica</li>
            </ul>
            <Link className="btn" href="/login">
              Crear cuenta
            </Link>
          </article>
          <article className="card plan featured">
            <span className="plan-badge pill gold">Más popular</span>
            <p className="eyebrow">Pago único</p>
            <h3>{mini.displayName}</h3>
            <p className="plan-price">
              ${mini.priceUsd.toFixed(2)} <small>una vez</small>
            </p>
            <p className="plan-tag">{mini.credits} canciones completas</p>
            <ul>
              <li>{mini.credits} tutoriales completos</li>
              <li>Hasta 10 minutos por canción</li>
              <li>Los créditos no caducan</li>
            </ul>
            <Link className="btn primary" href="/pricing">
              Ver Mini Pack
            </Link>
          </article>
          <article className="card plan">
            <p className="eyebrow">Mensual · pronto</p>
            <h3>Practice y Plus</h3>
            <p className="plan-price">
              desde ${BILLING_PRODUCTS.practice.priceUsd.toFixed(2)} <small>/ mes</small>
            </p>
            <p className="plan-tag">Para quien practica cada semana</p>
            <ul>
              <li>20 o 50 tutoriales al mes</li>
              <li>Hasta 10 minutos por canción</li>
              <li className="dim">Disponible próximamente</li>
            </ul>
            <Link className="btn" href="/pricing">
              Detalles
            </Link>
          </article>
        </div>
      </section>

      <section className="section" aria-labelledby="faq">
        <div className="section-head">
          <p className="eyebrow">Preguntas frecuentes</p>
          <h2 id="faq">Lo que suelen preguntarnos</h2>
        </div>
        <div className="faq">
          <details>
            <summary>¿Qué tan precisa es la transcripción?</summary>
            <p>
              Muy buena con grabaciones limpias de piano solo. Con mucho ruido, otros instrumentos o pedal
              constante puede haber notas de más o de menos; el tutorial sigue siendo una guía útil, no una
              partitura oficial.
            </p>
          </details>
          <details>
            <summary>¿Qué es la vista previa gratuita?</summary>
            <p>
              Con el plan gratis procesamos solo los primeros {FREE_PREVIEW_SECONDS} segundos de la canción que
              subas, así compruebas la calidad antes de pagar. Con un Mini Pack puedes desbloquear la canción
              completa.
            </p>
          </details>
          <details>
            <summary>¿Funciona en el celular?</summary>
            <p>Sí. La web funciona en iPhone, Android y tablet; el tutorial se ve mejor con el teléfono en horizontal.</p>
          </details>
          <details>
            <summary>¿Puedo subir cualquier canción?</summary>
            <p>Solo audio del que tengas derecho a procesar. Pianissimo no redistribuye música ni descarga de plataformas.</p>
          </details>
        </div>
      </section>

      <AppFooter />
    </main>
  );
}
