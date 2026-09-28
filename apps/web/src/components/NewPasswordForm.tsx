"use client";

/** Se muestra al entrar por un enlace de recuperación de contraseña. */

import { type FormEvent, useState } from "react";

import Brand from "@/components/Brand";
import { supabase } from "@/lib/supabase";

export default function NewPasswordForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase().auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError("No pudimos guardar la contraseña. Prueba con otra o pide un enlace nuevo.");
      return;
    }
    onDone();
  };

  return (
    <div className="auth" style={{ gridTemplateColumns: "1fr" }}>
      <section className="auth-form">
        <form onSubmit={submit}>
          <Brand href="/landing" />
          <div>
            <h1>Nueva contraseña</h1>
            <p className="subtitle" style={{ marginTop: "0.4rem" }}>
              Elige una contraseña de al menos 6 caracteres.
            </p>
          </div>
          <input
            className="input"
            type="password"
            placeholder="Nueva contraseña"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoFocus
            aria-label="Nueva contraseña"
          />
          {error && (
            <div className="notice" role="alert">
              {error}
            </div>
          )}
          <button className="btn primary lg block" type="submit" disabled={busy}>
            {busy ? "Guardando…" : "Guardar y entrar"}
          </button>
        </form>
      </section>
    </div>
  );
}
