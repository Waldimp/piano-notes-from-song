"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthGate";
import UsageBanner, { type UsageInfo } from "@/components/UsageBanner";
import { supabase } from "@/lib/supabase";

export default function AccountPage() {
  const { email } = useAuth();
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      if (!res.ok) {
        setError(body.error ?? "Failed to load usage");
        return;
      }
      setUsage(body.usage as UsageInfo);
    })();
  }, []);

  return (
    <main className="home">
      <div className="topbar">
        <div>
          <h1>Account</h1>
          <p className="subtitle" style={{ margin: 0 }}>
            {email}
          </p>
        </div>
        <Link className="btn small" href="/">
          Back
        </Link>
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
              <strong>Upgrade — coming soon</strong>
            </p>
          )}
        </section>
      )}
    </main>
  );
}
