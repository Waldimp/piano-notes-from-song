"use client";

import type { ReactNode } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthGate";
import { SITE_NAME } from "@/lib/site";

type Props = {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
};

export default function AppHeader({ title, subtitle, actions }: Props) {
  const { email, signOut } = useAuth();

  return (
    <>
      <header className="app-nav" role="banner">
        <Link href="/" className="app-nav-logo">
          {SITE_NAME}
        </Link>
        <nav className="app-nav-links" aria-label="Principal">
          <Link href="/">Tus canciones</Link>
          <Link href="/pricing">Precios</Link>
          <Link href="/account">Cuenta</Link>
        </nav>
        {email && (
          <div className="app-nav-user">
            <span className="app-nav-email" title={email}>
              {email}
            </span>
            <button type="button" className="btn small" onClick={() => void signOut()}>
              Salir
            </button>
          </div>
        )}
      </header>
      {(title || subtitle || actions) && (
        <div className="topbar">
          <div>
            {title && <h1>{title}</h1>}
            {subtitle && (
              <p className="subtitle" style={{ margin: 0 }}>
                {subtitle}
              </p>
            )}
          </div>
          {actions}
        </div>
      )}
    </>
  );
}
