"use client";

/**
 * En modo nube exige sesion de Supabase antes de mostrar la app.
 * En modo local (tu PC) no hace nada: deja pasar.
 *
 * Rutas publicas (landing, login, precios, legales) se muestran sin sesion,
 * pero si hay sesion tambien reciben el contexto de usuario.
 */

import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";

import { isCloudMode, supabase } from "@/lib/supabase";
import NewPasswordForm from "./NewPasswordForm";

interface AuthValue {
  email: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue>({ email: null, signOut: async () => {} });

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}

const PUBLIC_PATHS = ["/terms", "/privacy", "/refund", "/landing", "/login", "/pricing", "/welcome", "/guia"];

function isPublicPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    if (!isCloudMode) return;
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!isCloudMode || session === undefined) return;
    if (session) {
      // Con sesion, /login y /landing llevan a la biblioteca.
      if (pathname === "/login" || pathname === "/landing") router.replace("/");
      return;
    }
    if (isPublicPath(pathname)) return;
    router.replace(pathname === "/" ? "/landing" : "/login");
  }, [session, pathname, router]);

  if (!isCloudMode) return <>{children}</>;

  const value: AuthValue = {
    email: session?.user.email ?? null,
    signOut: async () => {
      await supabase().auth.signOut();
      router.replace("/landing");
    },
  };

  if (isPublicPath(pathname)) {
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
  }

  if (session === undefined || !session) {
    return (
      <div className="message" role="status">
        Cargando…
      </div>
    );
  }
  if (recovering) {
    return <NewPasswordForm onDone={() => setRecovering(false)} />;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
