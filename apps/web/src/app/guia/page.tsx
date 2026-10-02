"use client";

import Link from "next/link";

import AppFooter from "@/components/AppFooter";
import AppHeader from "@/components/AppHeader";
import { useAuth } from "@/components/AuthGate";
import Brand from "@/components/Brand";
import Reveal from "@/components/Reveal";
import SoftBackdrop from "@/components/soft/SoftBackdrop";
import { Sprout } from "@/components/soft/Illustrations";

const TIPS = [
  { n: "01", t: "Escucha antes de tocar", d: "Reproduce la canción una vez a 1x solo mirando. Tu cerebro aprende el mapa antes de que tus manos lo recorran.", tone: "m" },
  { n: "02", t: "Despacio primero", d: "Empieza a 0.5x. Si no sale limpio despacio, no saldrá rápido. La velocidad llega sola cuando el movimiento ya está.", tone: "" },
  { n: "03", t: "Una mano a la vez", d: "Filtra la mano derecha (matcha) o la izquierda (chai). Cuando cada una fluya, júntalas en un pasaje corto.", tone: "c" },
  { n: "04", t: "Loop del pasaje difícil", d: "Marca A y B alrededor de los dos compases que se traban. Repítelos diez veces seguidas sin parar al fallar.", tone: "" },
  { n: "05", t: "Sesiones cortas", d: "Quince minutos diarios valen más que dos horas el domingo. Guarda marcadores para retomar justo donde ibas.", tone: "m" },
  { n: "06", t: "Disfruta el proceso", d: "Toca una canción que ya domines al final de cada sesión. Terminar con algo bonito te trae de vuelta mañana.", tone: "c" },
];

export default function GuidePage() {
  const { email } = useAuth();
  return (
    <main className="shell">
      {email ? (
        <AppHeader />
      ) : (
        <header className="nav">
          <div className="nav-inner">
            <Brand href="/landing" />
            <div className="nav-spacer" />
            <Link className="btn small" href="/login">
              Entrar
            </Link>
          </div>
        </header>
      )}
      <SoftBackdrop rain={0.3} clouds={false} />

      <section className="section-head center" style={{ margin: "3rem auto 0", maxWidth: 640, position: "relative" }}>
        <p className="eyebrow">Guía de práctica</p>
        <h1>
          Cómo <span className="script">practicar</span> con Pianissimo
        </h1>
        <p>Seis hábitos sencillos, pensados para pianistas que estudian por su cuenta. Sin prisa y sin culpa.</p>
        <Sprout className="sprout-inline" />
      </section>

      <div className="guide-grid">
        {TIPS.map((tip, i) => (
          <Reveal key={tip.n} className={`guide-card ${tip.tone}`} delay={i * 90}>
            <div className="n">{tip.n}</div>
            <h3>{tip.t}</h3>
            <p>{tip.d}</p>
          </Reveal>
        ))}
      </div>

      <Reveal className="cta-final" style={{ marginTop: "3rem", paddingBottom: "2rem" }}>
        <h2>
          Hoy es un buen día para <span className="script">tocar</span>
        </h2>
        <div className="row">
          <Link className="btn primary lg" href={email ? "/" : "/login"}>
            {email ? "Ir a mis canciones" : "Empezar gratis"}
          </Link>
        </div>
      </Reveal>

      <AppFooter />
    </main>
  );
}
