"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import AppFooter from "@/components/AppFooter";
import AppHeader from "@/components/AppHeader";
import { useAuth } from "@/components/AuthGate";
import Reveal from "@/components/Reveal";
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
      <AppHeader />

      <section className="section-head" style={{ margin: "3rem auto 0", textAlign: "center", maxWidth: 680 }}>
        <p className="eyebrow">Precios</p>
        <h1>Paga por canción, no por mes… salvo que quieras</h1>
        <p>
          Cada tutorial completo consume un crédito. Reproducir, ralentizar y repetir en loop los que ya tienes es
          gratis, siempre.
        </p>
      </section>

      {msg && (
        <div className={`notice${msg.kind === "info" ? " info" : ""}`} role="alert" style={{ marginTop: "1.5rem" }}>
          {msg.text}
        </div>
      )}
      {sandboxMode && (
        <p className="notice info" role="status" style={{ marginTop: "1.5rem", textAlign: "center" }}>
          Los pagos están en modo de prueba: no se realizará ningún cobro real.
        </p>
      )}

      <Reveal className="pricing-editorial">
        <article className="price-hero" aria-labelledby="mini-title">
          <p className="eyebrow">Mini Pack · pago único</p>
          <h2 id="mini-title" className="big">
            ${mini.priceUsd.toFixed(2)} <small>USD, una vez</small>
          </h2>
          <p className="lead">{mini.credits} canciones completas, hasta 10 minutos cada una.</p>
          <ul>
            <li>Los créditos no caducan</li>
            <li>Desbloquea las vistas previas que ya tienes</li>
            <li>Velocidad, loop A/B y manos por color en todas</li>
          </ul>
          {email ? (
            <button
              className="btn primary lg"
              type="button"
              disabled={busy !== null || !billingEnabled}
              onClick={() => void startCheckout("mini_pack")}
            >
              {busy === "mini_pack" ? "Abriendo pago…" : `Comprar por $${mini.priceUsd.toFixed(2)}`}
            </button>
          ) : (
            <Link className="btn primary lg" href="/login">
              Entrar para comprar
            </Link>
          )}
          {email && !billingEnabled && <p className="plan-foot">Los pagos no están disponibles en este momento.</p>}
          <p className="plan-foot">Pago seguro con tarjeta a través de Wompi. No guardamos datos de tu tarjeta.</p>
        </article>

        <div className="price-side">
          <div className="price-row">
            <div>
              <div className="name">Gratis</div>
              <div className="desc">
                {FREE_CREDITS} vistas previas · los primeros {FREE_PREVIEW_SECONDS} s de cualquier canción
              </div>
            </div>
            <div className="amount">
              $0
              <div>
                <Link className="btn xs" href={email ? "/" : "/login"}>
                  {email ? "Subir canción" : "Crear cuenta"}
                </Link>
              </div>
            </div>
          </div>
          <div className="price-row soon">
            <div>
              <div className="name">{practice.displayName}</div>
              <div className="desc">{practice.credits} canciones cada mes · Próximamente</div>
            </div>
            <div className="amount">
              ${practice.priceUsd.toFixed(2)}
              <small> /mes</small>
            </div>
          </div>
          <div className="price-row soon">
            <div>
              <div className="name">{plus.displayName}</div>
              <div className="desc">{plus.credits} canciones cada mes · Próximamente</div>
            </div>
            <div className="amount">
              ${plus.priceUsd.toFixed(2)}
              <small> /mes</small>
            </div>
          </div>
          <p className="price-foot">Precios en dólares. Hasta 10 minutos por canción en los planes de pago. Sin cargos ocultos.</p>
        </div>
      </Reveal>

      <section className="section" aria-labelledby="pricing-faq" style={{ paddingTop: "4rem" }}>
        <div className="section-head">
          <p className="eyebrow">Dudas frecuentes</p>
          <h2 id="pricing-faq">Preguntas sobre pagos</h2>
        </div>
        <div className="faq">
          <details>
            <summary>¿Qué pasa con mis vistas previas al comprar?</summary>
            <p>Siguen en tu biblioteca. Con créditos puedes procesar la canción completa desde la propia portada.</p>
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
