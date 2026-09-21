"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { supabase } from "@/lib/supabase";

type UsageSnapshot = { credit_balance?: number; plan_code?: string };

/**
 * Redirect landing after Wompi hosted checkout.
 * Does NOT grant credits — webhook + TransaccionCompra confirmation does.
 * Never claims payment success from redirect params alone.
 */
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
      <div className="topbar">
        <div>
          <h1>Confirming payment</h1>
          <p className="subtitle" style={{ margin: 0 }}>
            Redirect confirmation alone does not grant credits. We wait for the
            Wompi webhook and a server-side transaction check. Refresh Account in
            a minute if credits are not updated yet.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Link className="btn small" href="/account">
            Account
          </Link>
          <Link className="btn small" href="/pricing">
            Pricing
          </Link>
        </div>
      </div>
      {usage && (
        <p style={{ marginTop: "1rem" }}>
          Current credits on account: {usage.credit_balance ?? "—"} (plan{" "}
          {usage.plan_code ?? "—"})
        </p>
      )}
    </main>
  );
}
