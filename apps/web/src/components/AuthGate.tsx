"use client";

/**
 * En modo nube exige sesion de Supabase antes de mostrar la app.
 * En modo local (tu PC) no hace nada: deja pasar.
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

const PUBLIC_PATHS = ["/terms", "/privacy", "/refund", "/landing", "/login"];

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
    if (session) return;
    if (isPublicPath(pathname)) return;
    if (pathname === "/") {
      router.replace("/landing");
      return;
    }
    if (pathname !== "/login") {
      router.replace("/login");
    }
  }, [session, pathname, router]);

  if (!isCloudMode) return <>{children}</>;

  if (isPublicPath(pathname)) {
    return <>{children}</>;
  }

  if (session === undefined) {
    return <div className="message">Cargando…</div>;
  }
  if (!session) {
    if (pathname === "/login") {
      return <>{children}</>;
    }
    return <div className="message">Cargando…</div>;
  }
  if (recovering) {
    return <NewPasswordForm onDone={() => setRecovering(false)} />;
  }

  const value: AuthValue = {
    email: session.user.email ?? null,
    signOut: async () => {
      await supabase().auth.signOut();
      router.replace("/landing");
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
