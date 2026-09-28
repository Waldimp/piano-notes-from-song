"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { planLabel } from "@/lib/userMessages";
import { isCloudMode, supabase } from "@/lib/supabase";

export type UsageInfo = {
  plan_code: string;
  credit_balance: number;
  credits_settled: number;
  max_duration_seconds: number;
};

export function useUsage(refreshKey = 0): { usage: UsageInfo | null; error: string | null; reload: () => void } {
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isCloudMode) return; // modo local: no hay planes ni sesión
    const { data } = await supabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const res = await fetch("/api/usage", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError("No pudimos cargar tu plan");
      return;
    }
    setUsage(body.usage as UsageInfo);
    setError(null);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return { usage, error, reload: () => void load() };
}

/** Chip compacto de plan + tutoriales disponibles (cabecera de la biblioteca). */
export default function UsageBanner({ refreshKey = 0 }: { refreshKey?: number }) {
  const { usage, error } = useUsage(refreshKey);

  if (error) {
    return (
      <span className="pill warn" role="status">
        {error}
      </span>
    );
  }
  if (!usage) return null;

  const remaining = usage.credit_balance;
  const isFree = usage.plan_code === "free";

  return (
    <Link href={remaining <= 0 ? "/pricing" : "/account"} className="plan-chip" role="status">
      <span>
        <strong>{planLabel(usage.plan_code)}</strong>
        <span className="sep"> · </span>
        {remaining} {remaining === 1 ? "tutorial" : "tutoriales"}
        {isFree ? " · vista previa 60 s" : ""}
      </span>
      <span className={`btn xs ${remaining <= 0 ? "primary" : ""}`}>
        {remaining <= 0 ? "Conseguir más" : "Ver plan"}
      </span>
    </Link>
  );
}
