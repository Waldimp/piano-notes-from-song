"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import AppFooter from "@/components/AppFooter";
import AppHeader from "@/components/AppHeader";
import { useAuth } from "@/components/AuthGate";
import { type UsageInfo } from "@/components/UsageBanner";
import { FREE_PREVIEW_SECONDS } from "@/lib/beta/preview";
import { subscriptionStatusDisplayEs } from "@/lib/billing/wompiSubscriptionStatus";
import { planLabel } from "@/lib/userMessages";
import { supabase } from "@/lib/supabase";

type SubRow = {
  product_code: string;
  status: string;
  current_period_starts_at?: string | null;
  current_period_ends_at: string | null;
  next_billing_at?: string | null;
};

type PurchaseRow = {
  id: string;
  product_code: string;
  amount_usd: number;
  credits: number;
  status: string;
  created_at: string;
};

function productName(code: string): string {
  if (code === "mini_pack") return "Mini Pack";
  if (code === "practice") return "Practice";
  if (code === "plus") return "Plus";
  return "Compra";
}

function purchaseStatus(status: string): { label: string; cls: string } {
  switch (status) {
    case "paid":
      return { label: "Pagada", cls: "ok" };
    case "pending":
      return { label: "Pendiente", cls: "warn" };
    case "refunded":
      return { label: "Reembolsada", cls: "info" };
    case "failed":
    case "cancelled":
      return { label: "No completada", cls: "" };
    default:
      return { label: "En revisión", cls: "" };
  }
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

export default function AccountPage() {
  const { email, signOut } = useAuth();
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const [usageRes, billingRes] = await Promise.all([
        fetch("/api/usage", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
        fetch("/api/billing/status", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
      ]);
      const usageBody = await usageRes.json().catch(() => ({}));
      if (!usageRes.ok) {
        setError("No pudimos cargar tu cuenta. Inténtalo de nuevo.");
        return;
      }
      setUsage(usageBody.usage as UsageInfo);
      const billingBody = await billingRes.json().catch(() => ({}));
      if (billingRes.ok) {
        setSubs((billingBody.subscriptions as SubRow[]) ?? []);
        setPurchases((billingBody.purchases as PurchaseRow[]) ?? []);
      }
    })();
  }, []);

  const activeSub = subs.find((s) => ["active", "past_due", "suspended", "pending"].includes(s.status));
  const isFree = usage?.plan_code === "free";
  const used = usage?.credits_settled ?? 0;
  const remaining = usage?.credit_balance ?? 0;

  return (
    <main className="shell">
      <AppHeader title="Tu cuenta" subtitle="Plan, tutoriales disponibles y pagos." />

      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}

      <div className="account-grid">
        <section className="card accent" aria-labelledby="plan-title">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <p className="eyebrow">Tu plan</p>
              <h2 id="plan-title">{usage ? planLabel(usage.plan_code) : "—"}</h2>
            </div>
            <Link className="btn small primary" href="/pricing">
              {isFree ? "Mejorar plan" : "Conseguir más"}
            </Link>
          </div>
          <div className="stat-row">
            <div className="stat">
              <div className="v">{usage ? remaining : "—"}</div>
              <div className="k">tutoriales disponibles</div>
            </div>
            <div className="stat">
              <div className="v">{usage ? used : "—"}</div>
              <div className="k">tutoriales creados</div>
            </div>
            <div className="stat">
              <div className="v">{usage ? (isFree ? `${FREE_PREVIEW_SECONDS} s` : `${Math.round(usage.max_duration_seconds / 60)} min`) : "—"}</div>
              <div className="k">{isFree ? "vista previa por canción" : "máximo por canción"}</div>
            </div>
          </div>
          {isFree && (
            <p className="muted small" style={{ marginTop: "0.9rem" }}>
              Con el plan gratis procesamos los primeros {FREE_PREVIEW_SECONDS} segundos de cada canción. Un Mini
              Pack desbloquea canciones completas de hasta 10 minutos.
            </p>
          )}
        </section>

        <section className="card" aria-labelledby="identity-title">
          <p className="eyebrow">Sesión</p>
          <h2 id="identity-title" style={{ fontSize: "1.2rem" }}>
            {email ?? "—"}
          </h2>
          <p className="muted small" style={{ marginTop: "0.5rem" }}>
            ¿No es tu cuenta? Cierra sesión y entra con el correo correcto.
          </p>
          <div className="row" style={{ marginTop: "1rem" }}>
            <button type="button" className="btn small" onClick={() => void signOut()}>
              Cerrar sesión
            </button>
          </div>
          <dl className="kv" style={{ marginTop: "1.25rem" }}>
            <dt>Términos</dt>
            <dd>
              <Link href="/terms">Ver</Link>
            </dd>
            <dt>Privacidad</dt>
            <dd>
              <Link href="/privacy">Ver</Link>
            </dd>
            <dt>Reembolsos</dt>
            <dd>
              <Link href="/refund">Ver</Link>
            </dd>
          </dl>
        </section>
      </div>

      <section className="card" style={{ marginTop: "1rem" }} aria-labelledby="billing-title">
        <p className="eyebrow">Pagos</p>
        <h2 id="billing-title" style={{ fontSize: "1.25rem" }}>
          Compras y suscripción
        </h2>

        {activeSub ? (
          <dl className="kv">
            <dt>Suscripción</dt>
            <dd>{productName(activeSub.product_code)}</dd>
            <dt>Estado</dt>
            <dd>{subscriptionStatusDisplayEs(activeSub.status)}</dd>
            <dt>Periodo</dt>
            <dd>
              {fmtDate(activeSub.current_period_starts_at)} → {fmtDate(activeSub.current_period_ends_at)}
            </dd>
            {activeSub.next_billing_at && (
              <>
                <dt>Próximo cobro</dt>
                <dd>{fmtDate(activeSub.next_billing_at)}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="muted" style={{ marginTop: "0.5rem" }}>
            No tienes suscripción mensual. Las suscripciones Practice y Plus llegarán pronto.
          </p>
        )}

        {purchases.length > 0 && (
          <ul className="stack" style={{ listStyle: "none", padding: 0, marginTop: "1rem" }}>
            {purchases.map((p) => {
              const st = purchaseStatus(p.status);
              return (
                <li key={p.id} className="row" style={{ justifyContent: "space-between", padding: "0.5rem 0", borderTop: "1px solid var(--border)" }}>
                  <span>
                    <strong>{productName(p.product_code)}</strong>
                    <span className="muted small"> · {p.credits} tutoriales · {fmtDate(p.created_at)}</span>
                  </span>
                  <span className="row">
                    <span>${Number(p.amount_usd).toFixed(2)}</span>
                    <span className={`pill ${st.cls}`}>{st.label}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <p className="muted small" style={{ marginTop: "1rem" }}>
          ¿Necesitas ayuda con un pago? Escríbenos desde el enlace de contacto al pie de la página.
        </p>
      </section>

      <AppFooter />
    </main>
  );
}
