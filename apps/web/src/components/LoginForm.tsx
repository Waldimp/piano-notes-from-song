"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";

import { supabase } from "@/lib/supabase";

type Mode = "login" | "register" | "forgot";

const MIN_PASSWORD = 6;

function friendly(message: string): string {
  if (message.includes("Invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (message.includes("Email not confirmed")) return "Confirma tu correo con el enlace que te enviamos.";
  if (message.toLowerCase().includes("rate limit"))
    return "Se alcanzó el límite de correos por hora. Inténtalo más tarde.";
  if (message.includes("Password should be at least"))
    return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;
  if (message.includes("User already registered")) return "Ese correo ya tiene cuenta: inicia sesión.";
  if (/_|jwt|pgrst/i.test(message)) return "No pudimos completar la operación. Inténtalo de nuevo.";
  return message;
}

export default function LoginForm({ initialMode = "login" }: { initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
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
          throw new Error(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
        }
        const { error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${origin}/` } });
        if (error) throw error;
        setNotice("Te enviamos un correo de confirmación. Abre el enlace desde este dispositivo para entrar.");
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: origin });
        if (error) throw error;
        setNotice("Si el correo existe, te enviamos un enlace para cambiar la contraseña.");
      }
    } catch (err) {
      setError(friendly(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "login" ? "Bienvenido de vuelta" : mode === "register" ? "Crea tu cuenta" : "Recuperar contraseña";
  const sub =
    mode === "login"
      ? "Entra para ver tus canciones y seguir practicando."
      : mode === "register"
        ? "Empieza gratis con 3 tutoriales de vista previa. Sin tarjeta."
        : "Te enviaremos un enlace para elegir una contraseña nueva.";

  return (
    <form onSubmit={submit}>
      <div>
        <h1>{title}</h1>
        <p className="subtitle" style={{ marginTop: "0.4rem" }}>
          {sub}
        </p>
      </div>

      <input
        className="input"
        type="email"
        placeholder="Correo electrónico"
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        aria-label="Correo electrónico"
      />
      {mode !== "forgot" && (
        <input
          className="input"
          type="password"
          placeholder={mode === "register" ? `Contraseña (mínimo ${MIN_PASSWORD})` : "Contraseña"}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={mode === "register" ? MIN_PASSWORD : undefined}
          aria-label="Contraseña"
        />
      )}

      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice info" role="status">
          {notice}
        </div>
      )}

      <button className="btn primary lg block" type="submit" disabled={busy}>
        {busy ? "Un momento…" : mode === "login" ? "Entrar" : mode === "register" ? "Crear cuenta" : "Enviar enlace"}
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

      <p className="auth-legal">
        Al continuar aceptas los <Link href="/terms">Términos</Link> y la <Link href="/privacy">Privacidad</Link>.
      </p>
    </form>
  );
}
