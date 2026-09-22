"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import AppFooter from "@/components/AppFooter";
import AppHeader from "@/components/AppHeader";
import { supabase } from "@/lib/supabase";

type UsageSnapshot = { credit_balance?: number; plan_code?: string };

export default function BillingReturnPage() {
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const res = await fetch("/api/usage", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setUsage((body.usage as UsageSnapshot) ?? null);
    })();
  }, []);

  return (
    <main className="home">
      <AppHeader
        title="Confirmando pago"
        subtitle="Estamos verificando tu compra. Los tutoriales se acreditan en cuanto el pago se confirma."
      />

      <p className="subtitle">
        Si no ves los tutoriales al instante, espera un minuto y revisa tu{" "}
        <Link href="/account">cuenta</Link>. No hace falta pagar de nuevo.
      </p>

      {usage && (
        <p style={{ marginTop: "1rem" }}>
          Tutoriales disponibles ahora: <strong>{usage.credit_balance ?? "—"}</strong> (plan{" "}
          {usage.plan_code ?? "—"})
        </p>
      )}

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.25rem", flexWrap: "wrap" }}>
        <Link className="btn active" href="/">
          Tus canciones
        </Link>
        <Link className="btn small" href="/account">
          Cuenta
        </Link>
      </div>

      <AppFooter />
    </main>
  );
}
