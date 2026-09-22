import Link from "next/link";

import AppFooter from "@/components/AppFooter";

export const metadata = { title: "Terms of Service — Pianissimo" };

export default function TermsPage() {
  return (
    <main className="home" style={{ maxWidth: 720 }}>
      <div className="topbar">
        <h1>Terms of Service</h1>
        <Link className="btn small" href="/landing">
          Inicio
        </Link>
      </div>
      <p className="subtitle">Last updated: 2026-09-21. Product: Pianissimo.</p>

      <section>
        <h2>1. Service</h2>
        <p>
          Pianissimo turns audio you upload into piano learning tutorials. The
          service is provided as-is during beta and may change or be interrupted.
        </p>
      </section>

      <section>
        <h2>2. Accounts</h2>
        <p>
          You must keep your login secure and are responsible for activity under
          your account. We may suspend accounts that abuse the service (spam,
          fraud, or attempts to bypass limits).
        </p>
      </section>

      <section>
        <h2>3. Credits and Mini Pack</h2>
        <p>
          Tutorials consume credits from your balance. The Free plan includes a
          limited grant. The Mini Pack is a one-time purchase of credits at the
          price shown at checkout. Credits have no cash value and are not a
          stored-value wallet beyond use inside Pianissimo.
        </p>
      </section>

      <section>
        <h2>4. Your uploads</h2>
        <p>
          You confirm you have the rights to upload and process the audio you
          submit. You must not upload illegal content or material you do not own
          or license. We may delete uploads that violate these terms.
        </p>
      </section>

      <section>
        <h2>5. Payments</h2>
        <p>
          Card payments are processed by Wompi (El Salvador). Pianissimo does not
          store card numbers or CVV. Successful payment confirmation comes from
          Wompi webhooks verified by our servers—not from the browser redirect
          alone.
        </p>
      </section>

      <section>
        <h2>6. Availability and liability</h2>
        <p>
          Processing depends on third-party infrastructure (hosting, database,
          GPU workers). We aim for reliability but do not guarantee uninterrupted
          service. To the extent permitted by applicable law, Pianissimo and its
          operators are not liable for indirect or consequential damages arising
          from use of the service.
        </p>
      </section>

      <section>
        <h2>7. Changes</h2>
        <p>
          We may update these terms. Continued use after changes means you accept
          the updated terms. Contact: support via the email on your account.
        </p>
      </section>

      <p>
        See also <Link href="/privacy">Privacy</Link> and{" "}
        <Link href="/refund">Refunds</Link>.
      </p>
      <AppFooter />
    </main>
  );
}
