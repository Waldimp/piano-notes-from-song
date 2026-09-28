"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import AppFooter from "@/components/AppFooter";
import AppHeader from "@/components/AppHeader";
import Brand from "@/components/Brand";
import { useAuth } from "@/components/AuthGate";
import { BILLING_PRODUCTS } from "@/lib/billing/catalog";
import { FREE_CREDITS, FREE_PREVIEW_SECONDS } from "@/lib/beta/preview";
import { mapBillingCheckoutError } from "@/lib/userMessages";
import { supabase } from "@/lib/supabase";

type Msg = { kind: "info" | "error"; text: string };

export default function PricingPage() {
  const { email } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [sandboxMode, setSandboxMode] = useState(false);
  const [billingEnabled, setBillingEnabled] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const res = await fetch("/api/billing/status", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setBillingEnabled(Boolean(body.billing_enabled));
        setSandboxMode(body.billing_enabled && !body.wompi_expect_productive);
      }
    })();
  }, []);

  const startCheckout = async (productCode: string) => {
    setMsg(null);
    setBusy(productCode);
    try {
      const { data } = await supabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setMsg({ kind: "error", text: "Inicia sesión para continuar." });
        return;
      }
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ product_code: productCode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: "error", text: mapBillingCheckoutError(body) });
        return;
      }
      if (body.url_enlace) {
        window.location.href = body.url_enlace as string;
        return;
      }
      setMsg({ kind: "error", text: "No recibimos el enlace de pago. Inténtalo de nuevo." });
    } finally {
      setBusy(null);
    }
  };

  const mini = BILLING_PRODUCTS.mini_pack;
  const practice = BILLING_PRODUCTS.practice;
  const plus = BILLING_PRODUCTS.plus;

  return (
    <main className="shell">
      {email ? (
        <AppHeader />
      ) : (
        <header className="nav" style={{ position: "static", background: "transparent", border: "none" }}>
          <div className="nav-inner" style={{ padding: 0 }}>
            <Brand href="/landing" />
            <div className="nav-spacer" />
            <Link className="btn small" href="/login">
              Entrar
            </Link>
          </div>
        </header>
      )}

      <section className="section-head" style={{ margin: "2.5rem auto 0", textAlign: "center", maxWidth: 640 }}>
        <p className="eyebrow">Precios</p>
        <h1>Paga solo por las canciones que aprendes</h1>
        <p>
          Cada tutorial completo consume un crédito. Reproducir, ralentizar y repetir en loop los que ya tienes
          es gratis, siempre.
        </p>
      </section>

      {msg && (
        <div className={`notice${msg.kind === "info" ? " info" : ""}`} role="alert" style={{ marginTop: "1.25rem" }}>
          {msg.text}
        </div>
      )}
      {sandboxMode && (
        <p className="notice info" role="status" style={{ marginTop: "1.25rem" }}>
          Los pagos están en modo de prueba: no se realizará ningún cobro real.
        </p>
      )}

      <div className="plans" style={{ marginTop: "2rem" }}>
        <article className="card plan">
          <p className="eyebrow">Gratis</p>
          <h3>Prueba</h3>
          <p className="plan-price">$0</p>
          <p className="plan-tag">Para conocer Pianissimo</p>
          <ul>
            <li>{FREE_CREDITS} tutoriales de vista previa</li>
            <li>Primeros {FREE_PREVIEW_SECONDS} s de cualquier canción</li>
            <li>Velocidad, loop A/B y manos por color</li>
          </ul>
          <Link className="btn" href={email ? "/" : "/login"}>
            {email ? "Subir una canción" : "Crear cuenta gratis"}
          </Link>
        </article>

        <article className="card plan featured">
          <span className="plan-badge pill gold">Más popular</span>
          <p className="eyebrow">Pago único</p>
          <h3>{mini.displayName}</h3>
          <p className="plan-price">
            ${mini.priceUsd.toFixed(2)} <small>USD · una vez</small>
          </p>
          <p className="plan-tag">{mini.credits} canciones completas</p>
          <ul>
            <li>{mini.credits} tutoriales completos</li>
            <li>Hasta 10 minutos por canción</li>
            <li>Los créditos no caducan</li>
            <li>Desbloquea tus vistas previas</li>
          </ul>
          {email ? (
            <button
              className="btn primary"
              type="button"
              disabled={busy !== null || !billingEnabled}
              onClick={() => void startCheckout("mini_pack")}
            >
              {busy === "mini_pack" ? "Abriendo pago…" : `Comprar por $${mini.priceUsd.toFixed(2)}`}
            </button>
          ) : (
            <Link className="btn primary" href="/login">
              Entrar para comprar
            </Link>
          )}
          {email && !billingEnabled && <p className="plan-foot">Los pagos no están disponibles en este momento.</p>}
          <p className="plan-foot">Pago seguro con tarjeta a través de Wompi. No guardamos datos de tu tarjeta.</p>
        </article>

        <article className="card plan">
          <p className="eyebrow">Mensual</p>
          <h3>{practice.displayName}</h3>
          <p className="plan-price">
            ${practice.priceUsd.toFixed(2)} <small>/ mes</small>
          </p>
          <p className="plan-tag">{practice.credits} canciones al mes</p>
          <ul>
            <li>{practice.credits} tutoriales cada mes</li>
            <li>Hasta 10 minutos por canción</li>
            <li className="dim">Disponible próximamente</li>
          </ul>
          <button className="btn" type="button" disabled aria-disabled="true">
            Próximamente
          </button>
        </article>

        <article className="card plan">
          <p className="eyebrow">Mensual</p>
          <h3>{plus.displayName}</h3>
          <p className="plan-price">
            ${plus.priceUsd.toFixed(2)} <small>/ mes</small>
          </p>
          <p className="plan-tag">{plus.credits} canciones al mes</p>
          <ul>
            <li>{plus.credits} tutoriales cada mes</li>
            <li>Hasta 10 minutos por canción</li>
            <li className="dim">Disponible próximamente</li>
          </ul>
          <button className="btn" type="button" disabled aria-disabled="true">
            Próximamente
          </button>
        </article>
      </div>

      <section className="section" aria-labelledby="pricing-faq">
        <div className="section-head">
          <h2 id="pricing-faq">Preguntas sobre pagos</h2>
        </div>
        <div className="faq">
          <details>
            <summary>¿Qué pasa con mis vistas previas al comprar?</summary>
            <p>Siguen en tu biblioteca. Con créditos puedes procesar la canción completa desde la propia tarjeta.</p>
          </details>
          <details>
            <summary>¿Caducan los créditos del Mini Pack?</summary>
            <p>No. Los usas cuando quieras.</p>
          </details>
          <details>
            <summary>¿Puedo pedir un reembolso?</summary>
            <p>
              Sí, según nuestra <Link href="/refund">política de reembolsos</Link>: créditos sin usar se pueden
              reembolsar; los ya consumidos se revisan caso por caso.
            </p>
          </details>
        </div>
      </section>

      <AppFooter />
    </main>
  );
}
