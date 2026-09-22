"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import AppFooter from "@/components/AppFooter";
import AppHeader from "@/components/AppHeader";
import { useAuth } from "@/components/AuthGate";
import { type UsageInfo } from "@/components/UsageBanner";
import { supabase } from "@/lib/supabase";

type SubRow = {
  product_code: string;
  status: string;
  current_period_starts_at?: string | null;
  current_period_ends_at: string | null;
  next_billing_at?: string | null;
  cancel_at_period_end?: boolean;
};

function planLabel(code: string): string {
  switch (code) {
    case "free":
      return "Gratis (FREE)";
    case "mini":
      return "Mini Pack";
    case "practice":
      return "Practice";
    case "plus":
      return "Plus";
    default:
      return code;
  }
}

function subStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Activa";
    case "past_due":
      return "Pago pendiente";
    case "canceled":
      return "Cancelada";
    default:
      return status;
  }
}

export default function AccountPage() {
  const { email } = useAuth();
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [subscriptionsEnabled, setSubscriptionsEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const [usageRes, billingRes] = await Promise.all([
        fetch("/api/usage", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch("/api/billing/status", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
      ]);
      const usageBody = await usageRes.json().catch(() => ({}));
      if (!usageRes.ok) {
        setError(usageBody.error ?? "No pudimos cargar tu cuenta");
        return;
      }
      setUsage(usageBody.usage as UsageInfo);

      const billingBody = await billingRes.json().catch(() => ({}));
      if (billingRes.ok) {
        setBillingEnabled(Boolean(billingBody.billing_enabled));
        setSubscriptionsEnabled(Boolean(billingBody.subscriptions_enabled));
        setSubs((billingBody.subscriptions as SubRow[]) ?? []);
      }
    })();
  }, []);

  const activeSub = subs.find((s) => s.status === "active" || s.status === "past_due");

  const durationLabel =
    usage != null
      ? usage.max_duration_seconds <= 60
        ? "1 minuto"
        : `${Math.round(usage.max_duration_seconds / 60)} minutos`
      : "—";

  return (
    <main className="home">
      <AppHeader title="Cuenta" subtitle="Revisa tu plan, tutoriales y facturación." />

      <section className="account-identity" aria-labelledby="identity-title">
        <h2 id="identity-title">Identidad</h2>
        <p>
          Correo de la sesión actual: <strong>{email ?? "—"}</strong>
        </p>
        <p className="subtitle">
          Si ves otra cuenta de la esperada, cierra sesión e inicia con el correo correcto.
        </p>
      </section>

      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}

      {usage && (
        <section className="account-section" aria-labelledby="usage-title">
          <h2 id="usage-title">Plan y tutoriales</h2>
          <ul className="account-list">
            <li>Plan: {planLabel(usage.plan_code)}</li>
            <li>Tutoriales disponibles: {usage.credit_balance}</li>
            <li>Tutoriales usados: {usage.credits_settled}</li>
            <li>Duración máxima por canción: {durationLabel}</li>
          </ul>
          {usage.credit_balance <= 0 && (
            <p>
              Sin tutoriales restantes. <Link href="/pricing">Ver precios</Link>
            </p>
          )}
        </section>
      )}

      <section className="account-section" aria-labelledby="billing-title">
        <h2 id="billing-title">Facturación</h2>
        <p className="subtitle">
          Pagos puntuales: {billingEnabled ? "activos" : "no disponibles en este entorno"}.
          Suscripciones mensuales: {subscriptionsEnabled ? "activas" : "próximamente"}.
        </p>
        {activeSub ? (
          <ul className="account-list">
            <li>Estado: {subStatusLabel(activeSub.status)}</li>
            <li>Producto: {activeSub.product_code}</li>
            <li>
              Periodo actual:{" "}
              {activeSub.current_period_starts_at
                ? new Date(activeSub.current_period_starts_at).toLocaleDateString()
                : "—"}{" "}
              →{" "}
              {activeSub.current_period_ends_at
                ? new Date(activeSub.current_period_ends_at).toLocaleDateString()
                : "—"}
            </li>
          </ul>
        ) : (
          <p>No tienes suscripción mensual activa.</p>
        )}
        <p className="subtitle">
          Para cancelar o gestionar suscripciones cuando estén disponibles, contáctanos desde el
          pie de página.
        </p>
        <Link className="btn small" href="/pricing">
          Ver precios
        </Link>
      </section>

      <section className="account-section" aria-labelledby="legal-title">
        <h2 id="legal-title">Legal</h2>
        <p>
          <Link href="/terms">Términos</Link>
          {" · "}
          <Link href="/privacy">Privacidad</Link>
          {" · "}
          <Link href="/refund">Reembolsos</Link>
        </p>
      </section>

      <AppFooter />
    </main>
  );
}
