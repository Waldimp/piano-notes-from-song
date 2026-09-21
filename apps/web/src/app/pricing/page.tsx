"use client";

import { useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthGate";
import { BILLING_PRODUCTS } from "@/lib/billing/catalog";
import { supabase } from "@/lib/supabase";

type Msg = { kind: "info" | "error"; text: string };

export default function PricingPage() {
  const { email } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);

  const startCheckout = async (productCode: string) => {
    setMsg(null);
    setBusy(productCode);
    try {
      const { data } = await supabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setMsg({ kind: "error", text: "Sign in to continue." });
        return;
      }
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ product_code: productCode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({
          kind: "error",
          text: body.error ?? body.code ?? "Checkout unavailable",
        });
        return;
      }
      if (body.url_enlace) {
        window.location.href = body.url_enlace as string;
        return;
      }
      setMsg({ kind: "error", text: "No payment URL returned" });
    } finally {
      setBusy(null);
    }
  };

  const free = {
    name: "Free",
    price: "$0",
    credits: "3 credits",
    note: "60s max per upload",
  };
  const mini = BILLING_PRODUCTS.mini_pack;
  const practice = BILLING_PRODUCTS.practice;
  const plus = BILLING_PRODUCTS.plus;

  return (
    <main className="home">
      <div className="topbar">
        <div>
          <h1>Pricing</h1>
          <p className="subtitle" style={{ margin: 0 }}>
            {email ? `Signed in as ${email}` : "Sign in to buy credits"}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Link className="btn small" href="/account">
            Account
          </Link>
          <Link className="btn small" href="/">
            Back
          </Link>
        </div>
      </div>

      {msg && (
        <div className="notice" style={{ marginTop: "1rem" }}>
          {msg.text}
        </div>
      )}

      <section style={{ marginTop: "1.5rem", display: "grid", gap: "1.25rem" }}>
        <article>
          <h2>{free.name}</h2>
          <p>
            {free.price} — {free.credits}. {free.note}.
          </p>
        </article>

        <article>
          <h2>{mini.displayName}</h2>
          <p>
            ${mini.priceUsd.toFixed(2)} one-time — +{mini.credits} credits.
          </p>
          <button
            className="btn"
            type="button"
            disabled={busy !== null}
            onClick={() => void startCheckout("mini_pack")}
          >
            {busy === "mini_pack" ? "Starting…" : "Buy Mini Pack"}
          </button>
        </article>

        <article>
          <h2>{practice.displayName}</h2>
          <p>
            ${practice.priceUsd.toFixed(2)}/mo — {practice.credits} credits per period.
          </p>
          <button className="btn" type="button" disabled title="Subscriptions setup in progress">
            Subscribe Practice
          </button>
          <p className="subtitle">Coming soon</p>
        </article>

        <article>
          <h2>{plus.displayName}</h2>
          <p>
            ${plus.priceUsd.toFixed(2)}/mo — {plus.credits} credits per period.
          </p>
          <button className="btn" type="button" disabled title="Subscriptions setup in progress">
            Subscribe Plus
          </button>
          <p className="subtitle">Coming soon</p>
        </article>
      </section>

      <p className="subtitle" style={{ marginTop: "2rem" }}>
        <Link href="/terms">Terms</Link>
        {" · "}
        <Link href="/privacy">Privacy</Link>
        {" · "}
        <Link href="/refund">Refunds</Link>
      </p>
    </main>
  );
}
