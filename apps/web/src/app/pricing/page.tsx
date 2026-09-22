"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import AppFooter from "@/components/AppFooter";
import AppHeader from "@/components/AppHeader";
import { useAuth } from "@/components/AuthGate";
import { BILLING_PRODUCTS } from "@/lib/billing/catalog";
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
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ product_code: productCode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({
          kind: "error",
          text: mapBillingCheckoutError(body),
        });
        return;
      }
      if (body.url_enlace) {
        window.location.href = body.url_enlace as string;
        return;
      }
      setMsg({ kind: "error", text: "No recibimos enlace de pago. Inténtalo de nuevo." });
    } finally {
      setBusy(null);
    }
  };

  const mini = BILLING_PRODUCTS.mini_pack;
  const practice = BILLING_PRODUCTS.practice;
  const plus = BILLING_PRODUCTS.plus;

  return (
    <main className="home">
      <AppHeader
        title="Precios"
        subtitle={email ? `Sesión: ${email}` : "Inicia sesión para comprar tutoriales"}
      />

      {msg && (
        <div className={`notice${msg.kind === "info" ? " info" : ""}`} role="alert">
          {msg.text}
        </div>
      )}

      {sandboxMode && (
        <p className="notice info" role="status">
          Mini Pack usa el entorno de prueba de pagos (sandbox). No se realizarán cobros reales.
        </p>
      )}

      <div className="pricing-grid">
        <article className="pricing-card">
          <p className="pricing-badge">Gratis</p>
          <h2>FREE</h2>
          <p className="pricing-price">$0</p>
          <ul>
            <li>3 tutoriales gratuitos</li>
            <li>Hasta 60 s por canción</li>
          </ul>
          <Link className="btn" href={email ? "/" : "/login"}>
            {email ? "Subir canción" : "Probar gratis"}
          </Link>
        </article>

        <article className="pricing-card pricing-card-highlight">
          <p className="pricing-badge">Pago único</p>
          <h2>Mini Pack</h2>
          <p className="pricing-price">${mini.priceUsd.toFixed(2)}</p>
          <ul>
            <li>5 tutoriales</li>
            <li>Hasta 10 min por canción</li>
            <li>One-time purchase</li>
          </ul>
          <button
            className="btn active"
            type="button"
            disabled={busy !== null || !billingEnabled}
            onClick={() => void startCheckout("mini_pack")}
          >
            {busy === "mini_pack" ? "Abriendo pago…" : "Comprar Mini Pack"}
          </button>
          {!billingEnabled && (
            <p className="subtitle">Pagos no disponibles en este entorno.</p>
          )}
        </article>

        <article className="pricing-card">
          <p className="pricing-badge">Mensual</p>
          <h2>Practice</h2>
          <p className="pricing-price">
            ${practice.priceUsd.toFixed(2)}
            <span className="pricing-period"> / mes</span>
          </p>
          <ul>
            <li>20 tutoriales / mes</li>
            <li>Hasta 10 min por canción</li>
          </ul>
          <button className="btn" type="button" disabled aria-disabled="true">
            Coming soon
          </button>
          <p className="subtitle">Suscripción mensual — disponible pronto.</p>
        </article>

        <article className="pricing-card">
          <p className="pricing-badge">Mensual</p>
          <h2>Plus</h2>
          <p className="pricing-price">
            ${plus.priceUsd.toFixed(2)}
            <span className="pricing-period"> / mes</span>
          </p>
          <ul>
            <li>50 tutoriales / mes</li>
            <li>Hasta 10 min por canción</li>
          </ul>
          <button className="btn" type="button" disabled aria-disabled="true">
            Coming soon
          </button>
          <p className="subtitle">Suscripción mensual — disponible pronto.</p>
        </article>
      </div>

      <AppFooter />
    </main>
  );
}
