"use client";

import Link from "next/link";

/**
 * Redirect landing after Wompi hosted checkout.
 * Does NOT grant credits — webhook + TransaccionCompra confirmation does.
 */
export default function BillingReturnPage() {
  return (
    <main className="home">
      <div className="topbar">
        <div>
          <h1>Payment received</h1>
          <p className="subtitle" style={{ margin: 0 }}>
            We are confirming your payment with Wompi. Credits appear on your account
            once the webhook settles (usually within a minute).
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Link className="btn small" href="/account">
            Account
          </Link>
          <Link className="btn small" href="/">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
