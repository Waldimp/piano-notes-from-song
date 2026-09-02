"use client";

import { type FormEvent, useState } from "react";

import { supabase } from "@/lib/supabase";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase().auth.signInWithPassword({ email, password });
    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "Correo o contraseña incorrectos"
          : error.message,
      );
    }
    setBusy(false);
  };

  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1>🎹 Piano Tutorial</h1>
        <p className="subtitle">Inicia sesión para ver tus canciones</p>
        <input
          className="input"
          type="email"
          placeholder="Correo"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="input"
          type="password"
          placeholder="Contraseña"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <div className="notice">{error}</div>}
        <button className="btn active" type="submit" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
        <p className="subtitle" style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>
          La sesión se mantiene abierta en este dispositivo hasta que pulses Salir.
        </p>
      </form>
    </div>
  );
}
