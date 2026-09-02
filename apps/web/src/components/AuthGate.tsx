"use client";

/**
 * En modo nube exige sesion de Supabase antes de mostrar la app.
 * En modo local (tu PC) no hace nada: deja pasar.
 *
 * La sesion persiste en el navegador y se renueva sola; solo termina
 * al pulsar "Salir".
 */

import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { isCloudMode, supabase } from "@/lib/supabase";
import LoginForm from "./LoginForm";

interface AuthValue {
  email: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue>({ email: null, signOut: async () => {} });

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!isCloudMode) return;
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!isCloudMode) return <>{children}</>;

  if (session === undefined) {
    return <div className="message">Cargando…</div>;
  }
  if (!session) {
    return <LoginForm />;
  }

  const value: AuthValue = {
    email: session.user.email ?? null,
    signOut: async () => {
      await supabase().auth.signOut();
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
