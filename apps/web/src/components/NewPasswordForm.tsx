"use client";

/** Se muestra al entrar por un enlace de recuperación de contraseña. */

import { type FormEvent, useState } from "react";

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
      setError(error.message);
      return;
    }
    onDone();
  };

  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1>🎹 Piano Tutorial</h1>
        <p className="subtitle">Elige tu nueva contraseña</p>
        <input
          className="input"
          type="password"
          placeholder="Nueva contraseña (mín. 6)"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          autoFocus
        />
        {error && <div className="notice">{error}</div>}
        <button className="btn active" type="submit" disabled={busy}>
          {busy ? "Guardando…" : "Guardar y entrar"}
        </button>
      </form>
    </div>
  );
}
