"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthGate";
import UsageBanner, { type UsageInfo } from "@/components/UsageBanner";
import { supabase } from "@/lib/supabase";

type SubRow = {
  product_code: string;
  status: string;
  current_period_ends_at: string | null;
};

export default function AccountPage() {
  const { email } = useAuth();
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [billingEnabled, setBillingEnabled] = useState(false);
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
        setError(usageBody.error ?? "Failed to load usage");
        return;
      }
      setUsage(usageBody.usage as UsageInfo);

      const billingBody = await billingRes.json().catch(() => ({}));
      if (billingRes.ok) {
        setBillingEnabled(Boolean(billingBody.billing_enabled));
        setSubs((billingBody.subscriptions as SubRow[]) ?? []);
      }
    })();
  }, []);

  const activeSub = subs.find((s) => s.status === "active" || s.status === "past_due");

  return (
    <main className="home">
      <div className="topbar">
        <div>
          <h1>Account</h1>
          <p className="subtitle" style={{ margin: 0 }}>
            {email}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Link className="btn small" href="/pricing">
            Pricing
          </Link>
          <Link className="btn small" href="/">
            Back
          </Link>
        </div>
      </div>

      <UsageBanner />

      {error && <div className="notice">{error}</div>}

      {usage && (
        <section style={{ marginTop: "1rem" }}>
          <h2>Usage</h2>
          <ul>
            <li>Plan: {usage.plan_code}</li>
            <li>Credits available: {usage.credit_balance}</li>
            <li>Tutorials completed (settled): {usage.credits_settled}</li>
            <li>Max duration: {usage.max_duration_seconds}s</li>
          </ul>
          {usage.credit_balance <= 0 && (
            <p>
              You&apos;ve used your free tutorials.{" "}
              <Link href="/pricing">View pricing</Link>
            </p>
          )}
        </section>
      )}

      <section style={{ marginTop: "1.25rem" }}>
        <h2>Subscription</h2>
        {activeSub ? (
          <ul>
            <li>Status: {activeSub.status}</li>
            <li>Product: {activeSub.product_code}</li>
            <li>
              Renewal / period end:{" "}
              {activeSub.current_period_ends_at
                ? new Date(activeSub.current_period_ends_at).toLocaleString()
                : "—"}
            </li>
          </ul>
        ) : (
          <p className="subtitle">
            {billingEnabled
              ? "No active paid subscription."
              : "Payments setup in progress."}
          </p>
        )}
        <p className="subtitle">
          Cancel / manage: not available until Wompi recurrent subscriber lifecycle
          is confirmed.
        </p>
      </section>
    </main>
  );
}
