"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import AppFooter from "@/components/AppFooter";
import AppHeader from "@/components/AppHeader";
import { planLabel } from "@/lib/userMessages";
import { supabase } from "@/lib/supabase";

type UsageSnapshot = { credit_balance?: number; plan_code?: string };

export default function BillingReturnPage() {
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [tick, setTick] = useState(0);

  // Reintenta unas veces: el webhook puede tardar unos segundos en acreditar.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const res = await fetch("/api/usage", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!cancelled && res.ok) setUsage((body.usage as UsageSnapshot) ?? null);
    })();
    if (tick < 5) {
      const t = setTimeout(() => setTick((n) => n + 1), 4000);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return (
    <main className="shell narrow">
      <AppHeader />
      <section className="card pad-lg accent" style={{ marginTop: "2rem", textAlign: "center" }}>
        <div className="dropzone-icon" style={{ margin: "0 auto 1rem" }} aria-hidden="true">
          ✓
        </div>
        <p className="eyebrow">Pago recibido</p>
        <h1>¡Gracias!</h1>
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          Estamos confirmando tu compra. Los tutoriales se acreditan en cuanto el banco confirma el pago; suele
          ser cuestión de segundos. No hace falta pagar de nuevo.
        </p>
        {usage && (
          <p style={{ marginTop: "1.25rem", fontSize: "1.05rem" }}>
            Ahora tienes <strong>{usage.credit_balance ?? "—"}</strong> tutoriales disponibles
            {usage.plan_code ? ` · plan ${planLabel(usage.plan_code)}` : ""}.
          </p>
        )}
        <div className="row" style={{ justifyContent: "center", marginTop: "1.5rem" }}>
          <Link className="btn primary lg" href="/">
            Ir a tus canciones
          </Link>
          <Link className="btn lg" href="/account">
            Ver cuenta
          </Link>
        </div>
      </section>
      <AppFooter />
    </main>
  );
}
