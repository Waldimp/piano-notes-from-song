import Link from "next/link";

import AppFooter from "@/components/AppFooter";

export const metadata = { title: "Privacy Policy — Pianissimo" };

export default function PrivacyPage() {
  return (
    <main className="home" style={{ maxWidth: 720 }}>
      <div className="topbar">
        <h1>Privacy Policy</h1>
        <Link className="btn small" href="/landing">
          Inicio
        </Link>
      </div>
      <p className="subtitle">Last updated: 2026-09-21. Product: Pianissimo.</p>

      <section>
        <h2>1. Data we process</h2>
        <ul>
          <li>Account: email and authentication identifiers (via Supabase Auth).</li>
          <li>Uploads: audio files you submit and derived tutorial data (notes).</li>
          <li>Usage: plan, credit balance, request status, and related logs.</li>
          <li>Billing metadata: purchase ids and Wompi transaction references (not card PAN/CVV).</li>
        </ul>
      </section>

      <section>
        <h2>2. Purpose</h2>
        <p>
          We process data to run the tutorial pipeline, enforce credit limits,
          provide your library, process payments, prevent abuse, and operate the
          product.
        </p>
      </section>

      <section>
        <h2>3. Processors / infrastructure</h2>
        <ul>
          <li>Supabase — auth, database, file storage.</li>
          <li>Vercel — web application hosting.</li>
          <li>Modal — GPU transcription workers.</li>
          <li>Wompi — payment processing (El Salvador).</li>
        </ul>
      </section>

      <section>
        <h2>4. Retention</h2>
        <p>
          Account and tutorial data are kept while your account is active. You may
          request deletion of your account data by contacting us. Billing records
          needed for reconciliation may be retained as required for operations.
        </p>
      </section>

      <section>
        <h2>5. Your rights</h2>
        <p>
          Depending on applicable law, you may request access, correction, or
          deletion of personal data associated with your account. Contact us using
          the email on your account.
        </p>
      </section>

      <section>
        <h2>6. Security</h2>
        <p>
          We use access controls (including row-level security) and do not store
          payment card secrets on Pianissimo servers. No method is perfectly
          secure; please protect your login.
        </p>
      </section>

      <p>
        See also <Link href="/terms">Terms</Link> and{" "}
        <Link href="/refund">Refunds</Link>.
      </p>
      <AppFooter />
    </main>
  );
}
