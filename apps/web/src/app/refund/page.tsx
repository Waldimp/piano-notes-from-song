import Link from "next/link";

import AppFooter from "@/components/AppFooter";

export const metadata = { title: "Refund Policy — Pianissimo" };

export default function RefundPage() {
  return (
    <main className="home" style={{ maxWidth: 720 }}>
      <div className="topbar">
        <h1>Refund Policy</h1>
        <Link className="btn small" href="/landing">
          Inicio
        </Link>
      </div>
      <p className="subtitle">Last updated: 2026-09-21. Applies to Mini Pack.</p>

      <section>
        <h2>1. Mini Pack</h2>
        <p>
          Mini Pack is a one-time purchase of credits. After a successful Wompi
          payment, credits are added to your account once.
        </p>
      </section>

      <section>
        <h2>2. Unused credits</h2>
        <p>
          If you request a refund before using the purchased credits, we may
          reverse the credit grant and process a refund through Wompi when the
          payment provider allows it.
        </p>
      </section>

      <section>
        <h2>3. Consumed credits</h2>
        <p>
          If some or all purchased credits were already used for tutorials, we do
          not automatically refund the full amount. We may offer a partial
          adjustment case-by-case; we will not invent a negative credit balance
          without review.
        </p>
      </section>

      <section>
        <h2>4. Duplicate or erroneous charges</h2>
        <p>
          If Wompi or our systems show a duplicate successful charge for the same
          purchase, contact us. We will reconcile against our billing records and
          the Wompi transaction id. Valid duplicates should be refunded or
          corrected without granting extra credits twice.
        </p>
      </section>

      <section>
        <h2>5. How to contact</h2>
        <p>
          Email us from the address on your Pianissimo account and include the
          approximate time of purchase and (if available) the Wompi authorization
          or transaction reference from your receipt.
        </p>
      </section>

      <p>
        See also <Link href="/terms">Terms</Link> and{" "}
        <Link href="/privacy">Privacy</Link>.
      </p>
      <AppFooter />
    </main>
  );
}
