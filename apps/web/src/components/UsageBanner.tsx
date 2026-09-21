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
      return "Free plan";
    case "mini":
      return "Mini pack";
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
      setError(body.error ?? "No se pudo cargar el uso");
      return;
    }
    setUsage(body.usage as UsageInfo);
    setError(null);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (error) return <p className="subtitle">{error}</p>;
  if (!usage) return null;

  const maxCreditsHint =
    usage.plan_code === "free" ? 3 : usage.credit_balance + usage.credits_settled;
  const remaining = usage.credit_balance;
  const durationMin = Math.round(usage.max_duration_seconds / 60);

  return (
    <div className="usage-banner" style={{ marginBottom: "1rem" }}>
      <p style={{ margin: 0 }}>
        <strong>{planLabel(usage.plan_code)}</strong>
        {" — "}
        {remaining} of {Math.max(maxCreditsHint, remaining)} credits remaining
        {" · "}
        Max duration: {usage.max_duration_seconds <= 60 ? "1 minute" : `${durationMin} minutes`}
        {" · "}
        <Link href="/account">Account</Link>
      </p>
      {remaining <= 0 && (
        <p style={{ margin: "0.35rem 0 0" }}>
          You&apos;ve used your free tutorials.{" "}
          <span className="subtitle">Upgrade — coming soon</span>
        </p>
      )}
    </div>
  );
}
