"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { supabase } from "@/lib/supabase";

export type UsageInfo = {
  plan_code: string;
  credit_balance: number;
  credits_settled: number;
  max_duration_seconds: number;
};

function planLabel(code: string): string {
  switch (code) {
    case "free":
      return "Gratis";
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

export default function UsageBanner({ refreshKey = 0 }: { refreshKey?: number }) {
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const res = await fetch("/api/usage", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "No pudimos cargar tu plan");
      return;
    }
    setUsage(body.usage as UsageInfo);
    setError(null);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (error) {
    return (
      <div className="notice info" role="status">
        {error}
      </div>
    );
  }
  if (!usage) return null;

  const used = usage.credits_settled;
  const remaining = usage.credit_balance;
  const pool = Math.max(remaining + used, remaining, used);
  const durationLabel =
    usage.max_duration_seconds <= 60
      ? "1 minuto"
      : `${Math.round(usage.max_duration_seconds / 60)} minutos`;

  return (
    <div className="usage-banner" role="status">
      <p style={{ margin: 0 }}>
        <strong>{planLabel(usage.plan_code)}</strong>
        {" · "}
        {remaining} tutorial{remaining === 1 ? "" : "es"} disponible
        {remaining === 1 ? "" : "s"}
        {pool > 0 ? ` (de ${pool})` : ""}
        {" · "}
        Máx. {durationLabel} por canción
        {" · "}
        <Link href="/account">Cuenta</Link>
      </p>
      {remaining <= 0 && (
        <p style={{ margin: "0.35rem 0 0" }}>
          Agotaste tus tutoriales. <Link href="/pricing">Ver precios</Link>
        </p>
      )}
    </div>
  );
}
