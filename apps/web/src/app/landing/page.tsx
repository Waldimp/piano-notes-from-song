import Link from "next/link";

import AppFooter from "@/components/AppFooter";
import Brand from "@/components/Brand";
import HeroDemo from "@/components/HeroDemo";
import LandingDemo from "@/components/LandingDemo";
import Reveal from "@/components/Reveal";
import SoftBackdrop from "@/components/soft/SoftBackdrop";
import { CloudUpload, GrandPiano, Sprout } from "@/components/soft/Illustrations";
import { BILLING_PRODUCTS } from "@/lib/billing/catalog";
import { FREE_CREDITS, FREE_PREVIEW_SECONDS } from "@/lib/beta/preview";
import { GENRES } from "@/lib/prefs";

const WAVE = [30, 55, 80, 45, 70, 95, 60, 35, 75, 50, 85, 40];
const FALL = [
  { x: 6, l: false },
  { x: 22, l: true },
  { x: 38, l: false },
  { x: 54, l: false },
  { x: 70, l: true },
  { x: 86, l: false },
];

export default function LandingPage() {
  const mini = BILLING_PRODUCTS.mini_pack;
  const practice = BILLING_PRODUCTS.practice;
  const plus = BILLING_PRODUCTS.plus;

  return (
    <main className="landing">
      <header className="nav floating">
        <div className="nav-inner">
          <Brand href="/landing" />
          <div className="nav-spacer" />
          <Link className="btn ghost small" href="/guia">
            Guía
          </Link>
          <Link className="btn ghost small" href="/pricing">
            Precios
          </Link>
          <Link className="btn small" href="/login">
            Entrar
          </Link>
        </div>
      </header>

      {/* HERO: el reproductor real, en acuarela, detrás de la caligrafía */}
      <section className="hero" aria-label="Pianissimo">
        <HeroDemo speed={0.75} startAt={3} minWidth={1100} />
        <div className="hero-shade" aria-hidden="true" />
        <SoftBackdrop rain={0} clouds={false} />
        <div className="hero-content">
          <p className="hero-brand">Pianissimo</p>
          <h1 className="hero-title">
            Tu canción. <em>Tu piano.</em> A tu ritmo.
          </h1>
          <p className="hero-lead">
            Sube un audio de piano y míralo caer sobre un teclado real. Practica despacio, en loop y mano por mano,
            sin prisa.
          </p>
          <div className="hero-cta">
            <Link className="btn primary lg" href="/welcome">
              Comenzar
            </Link>
            <Link className="btn lg" href="#demo">
              Ver cómo funciona
            </Link>
          </div>
          <p className="hero-fine">
            {FREE_CREDITS} vistas previas de {FREE_PREVIEW_SECONDS} s gratis · sin tarjeta
          </p>
        </div>
        <div className="hero-scroll" aria-hidden="true">
          <i />
          <span>Desliza</span>
        </div>
      </section>

      {/* DEMO INTERACTIVA */}
      <section className="section" id="demo" aria-labelledby="demo-title">
        <div className="section-inner">
          <Reveal className="section-head">
            <p className="eyebrow">Así se practica</p>
            <h2 id="demo-title">
              Tócalo con los <span className="script">controles de verdad</span>
            </h2>
            <p>Baja la velocidad, repite un pasaje o quédate con una mano. Los mismos controles que tendrás en tu tutorial.</p>
          </Reveal>
          <Reveal delay={120}>
            <LandingDemo />
          </Reveal>
        </div>
      </section>

      {/* TRES MOMENTOS */}
      <section className="section" aria-labelledby="how-title">
        <div className="section-inner">
          <Reveal className="section-head">
            <p className="eyebrow">De un audio a tus manos</p>
            <h2 id="how-title">
              Tres momentos, <span className="script">un minuto</span>
            </h2>
          </Reveal>
          <div className="moments">
            <Reveal className="moment" delay={0}>
              <div className="motif motif-wave" aria-hidden="true">
                {WAVE.map((h, i) => (
                  <i key={i} style={{ ["--h" as string]: h, ["--i" as string]: i }} />
                ))}
              </div>
              <span className="n">Sube</span>
              <h3>Una grabación de piano</h3>
              <p>MP3, WAV, M4A, FLAC u OGG. Un cover que te guste, una clase, tu propia toma.</p>
            </Reveal>
            <Reveal className="moment" delay={120}>
              <div className="motif motif-detect" aria-hidden="true">
                {Array.from({ length: 48 }, (_, i) => (
                  <i key={i} style={{ ["--i" as string]: (i * 7) % 48 }} />
                ))}
              </div>
              <span className="n">Escuchamos</span>
              <h3>La IA detecta cada nota</h3>
              <p>Altura, duración, intensidad y pedal, con un modelo entrenado solo en piano.</p>
            </Reveal>
            <Reveal className="moment" delay={240}>
              <div className="motif motif-fall" aria-hidden="true">
                {FALL.map((n, i) => (
                  <i key={i} className={n.l ? "l" : ""} style={{ ["--x" as string]: n.x, ["--i" as string]: i }} />
                ))}
              </div>
              <span className="n">Practicas</span>
              <h3>Notas que caen sobre 88 teclas</h3>
              <p>Ves qué tecla, cuándo y cuánto. Y el tutorial espera tu ritmo, no al revés.</p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* TU ESTILO */}
      <section className="section" aria-labelledby="style-title">
        <div className="section-inner">
          <Reveal className="section-head center">
            <p className="eyebrow">Encuentra tu estilo</p>
            <h2 id="style-title">
              Lo que te gusta <span className="script">tocar</span>
            </h2>
            <p>Pop, clásico, anime, bandas sonoras… Pianissimo funciona con cualquier grabación de piano. Cuéntanos tu estilo al empezar.</p>
          </Reveal>
          <Reveal className="genre-cloud" delay={120} style={{ marginTop: "1.8rem", maxWidth: 560 }}>
            {GENRES.map((g, i) => (
              <span key={g.id} className={`genre ${g.tone}`} style={{ ["--d" as string]: `${(i % 5) * 0.4}s` }}>
                {g.label}
              </span>
            ))}
          </Reveal>
        </div>
      </section>

      {/* FEATURES */}
      <section className="section" aria-labelledby="features-title">
        <div className="section-inner">
          <Reveal className="section-head">
            <p className="eyebrow">Hecho para practicar</p>
            <h2 id="features-title">
              Todo lo que necesita <span className="script">una sesión</span>
            </h2>
          </Reveal>
          <div className="features">
            <Reveal className="feature">
              <div>
                <p className="eyebrow">Loop A · B</p>
                <h3>Repite el pasaje difícil hasta que salga</h3>
                <p>Marca un inicio y un final y el tutorial vuelve solo. La banda te muestra exactamente qué compases estás repitiendo.</p>
              </div>
              <div className="feature-visual">
                <HeroDemo speed={0.7} loop={[8, 14]} startAt={8} minWidth={640} />
              </div>
            </Reveal>

            <Reveal className="feature flip">
              <div>
                <p className="eyebrow">Velocidad</p>
                <h3>Despacio primero, a tempo después</h3>
                <p>0.5x, 0.75x, 1x y 1.25x sin que cambie el tono. El audio original sigue siendo el reloj.</p>
              </div>
              <div className="feature-visual">
                <div className="metro" aria-hidden="true">
                  <div className="pend" style={{ ["--period" as string]: "1.6s" }} />
                  <div className="speeds">
                    <span className="speed-tag">0.5x</span>
                    <span className="speed-tag on">0.75x</span>
                    <span className="speed-tag">1x</span>
                    <span className="speed-tag">1.25x</span>
                  </div>
                </div>
              </div>
            </Reveal>

            <Reveal className="feature">
              <div>
                <p className="eyebrow">Manos</p>
                <h3>Matcha para la derecha, chai para la izquierda</h3>
                <p>Filtra una mano para estudiarla sola y ve cómo encaja con la otra. Separación aproximada, pensada para practicar.</p>
              </div>
              <div className="feature-visual">
                <HeroDemo speed={0.7} handFilter="left" startAt={12} minWidth={640} />
              </div>
            </Reveal>

            <Reveal className="feature flip">
              <div>
                <p className="eyebrow">Vista previa gratis</p>
                <h3>Los primeros {FREE_PREVIEW_SECONDS} segundos, sin pagar</h3>
                <p>
                  Sube cualquier canción con el plan gratis: procesamos el primer minuto para que compruebes la calidad.
                  Si te convence, desbloqueas la canción completa con un crédito.
                </p>
              </div>
              <div className="feature-visual">
                <CloudUpload className="feature-illo" />
                <div className="timeline" aria-hidden="true">
                  <div className="played" />
                  <div className="locked" />
                </div>
                <div className="timeline-labels" aria-hidden="true">
                  <span>0:00</span>
                  <span className="timeline-mark">1:00 · vista previa</span>
                  <span>3:14</span>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="section" aria-labelledby="plans-title">
        <div className="section-inner">
          <Reveal className="section-head">
            <p className="eyebrow">Precios</p>
            <h2 id="plans-title">
              Paga por canción, <span className="script">no por mes</span>
            </h2>
            <p>Un tutorial completo consume un crédito. Reproducir los que ya tienes es gratis, siempre.</p>
          </Reveal>
          <Reveal className="pricing-editorial" delay={100}>
            <div className="price-hero">
              <p className="eyebrow">Mini Pack · pago único</p>
              <p className="big">
                ${mini.priceUsd.toFixed(2)} <small>USD</small>
              </p>
              <p className="lead">{mini.credits} canciones completas, hasta 10 minutos cada una.</p>
              <ul>
                <li>Los créditos no caducan</li>
                <li>Desbloquea tus vistas previas</li>
                <li>Pago con tarjeta vía Wompi</li>
              </ul>
              <Link className="btn primary lg" href="/pricing">
                Ver Mini Pack
              </Link>
            </div>
            <div className="price-side">
              <div className="price-row">
                <div>
                  <div className="name">Gratis</div>
                  <div className="desc">
                    {FREE_CREDITS} vistas previas × {FREE_PREVIEW_SECONDS} s
                  </div>
                </div>
                <div className="amount">$0</div>
              </div>
              <div className="price-row soon">
                <div>
                  <div className="name">{practice.displayName}</div>
                  <div className="desc">{practice.credits} canciones al mes · próximamente</div>
                </div>
                <div className="amount">
                  ${practice.priceUsd.toFixed(2)}
                  <small> /mes</small>
                </div>
              </div>
              <div className="price-row soon">
                <div>
                  <div className="name">{plus.displayName}</div>
                  <div className="desc">{plus.credits} canciones al mes · próximamente</div>
                </div>
                <div className="amount">
                  ${plus.priceUsd.toFixed(2)}
                  <small> /mes</small>
                </div>
              </div>
              <p className="price-foot">Precios en dólares. Sin cargos ocultos.</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="cta-final" aria-labelledby="cta-title">
        <SoftBackdrop rain={0.6} />
        <Reveal style={{ position: "relative" }}>
          <GrandPiano className="cta-illo" />
          <h2 id="cta-title">
            Practica <span className="script">y disfruta</span>
          </h2>
          <Sprout className="sprout-inline" />
          <div className="row">
            <Link className="btn primary lg" href="/welcome">
              Comenzar gratis
            </Link>
            <Link className="btn lg" href="/guia">
              Leer la guía
            </Link>
          </div>
        </Reveal>
      </section>

      <div className="section-inner">
        <AppFooter />
      </div>
    </main>
  );
}
