"use client";

/**
 * Entrar / Registrarse / Olvidé mi contraseña.
 *
 * Registro y recuperación usan los enlaces por correo de Supabase (las
 * plantillas con código OTP no están disponibles en el plan Free). Al pulsar
 * el enlace, Supabase redirige a la app ya con sesión.
 */

import { type FormEvent, useState } from "react";

import { supabase } from "@/lib/supabase";

type Mode = "login" | "register" | "forgot";

const MIN_PASSWORD = 6;

function friendly(message: string): string {
  if (message.includes("Invalid login credentials")) return "Correo o contraseña incorrectos";
  if (message.includes("Email not confirmed")) return "Confirma tu correo con el enlace que te enviamos";
  if (message.includes("rate limit") || message.includes("Rate limit"))
    return "Se alcanzó el límite de correos por hora. Inténtalo más tarde.";
  if (message.includes("Password should be at least"))
    return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`;
  if (message.includes("User already registered")) return "Ese correo ya tiene cuenta: inicia sesión";
  return message;
}

export default function LoginForm() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const sb = supabase();
    const origin = window.location.origin;

    try {
      if (mode === "login") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "register") {
        if (password.length < MIN_PASSWORD) {
          throw new Error(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`);
        }
        const { error } = await sb.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: origin },
        });
        if (error) throw error;
        setNotice(
          "Te enviamos un correo de confirmación. Abre el enlace desde este dispositivo y entrarás directo. (Puede tardar unos minutos.)",
        );
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: origin });
        if (error) throw error;
        setNotice(
          "Si el correo existe, te enviamos un enlace para cambiar la contraseña. Ábrelo desde este dispositivo.",
        );
      }
    } catch (err) {
      setError(friendly(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === "login" ? "Inicia sesión para ver tus canciones"
    : mode === "register" ? "Crea tu cuenta"
    : "Recuperar contraseña";

  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1>🎹 Piano Tutorial</h1>
        <p className="subtitle">{title}</p>

        <input
          className="input"
          type="email"
          placeholder="Correo"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {mode !== "forgot" && (
          <input
            className="input"
            type="password"
            placeholder={mode === "register" ? `Contraseña (mín. ${MIN_PASSWORD})` : "Contraseña"}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === "register" ? MIN_PASSWORD : undefined}
          />
        )}

        {error && <div className="notice">{error}</div>}
        {notice && <div className="notice info">{notice}</div>}

        <button className="btn active" type="submit" disabled={busy}>
          {busy ? "Un momento…"
            : mode === "login" ? "Entrar"
            : mode === "register" ? "Registrarme"
            : "Enviar enlace"}
        </button>

        <div className="auth-links">
          {mode !== "login" && (
            <button type="button" className="btn link" onClick={() => switchMode("login")}>
              Ya tengo cuenta
            </button>
          )}
          {mode !== "register" && (
            <button type="button" className="btn link" onClick={() => switchMode("register")}>
              Crear cuenta
            </button>
          )}
          {mode !== "forgot" && (
            <button type="button" className="btn link" onClick={() => switchMode("forgot")}>
              Olvidé mi contraseña
            </button>
          )}
        </div>

        <p className="subtitle" style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>
          La sesión se mantiene abierta en este dispositivo hasta que pulses Salir.
        </p>
      </form>
    </div>
  );
}
