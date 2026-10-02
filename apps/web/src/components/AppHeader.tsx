"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAuth } from "@/components/AuthGate";
import Brand from "@/components/Brand";

type Props = {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
};

const LINKS: Array<{ href: string; label: string }> = [
  { href: "/", label: "Tus canciones" },
  { href: "/guia", label: "Guía" },
  { href: "/pricing", label: "Precios" },
];

export default function AppHeader({ title, subtitle, actions }: Props) {
  const { email, signOut } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = (email?.[0] ?? "P").toUpperCase();

  return (
    <>
      <header className="nav" role="banner">
        <div className="nav-inner">
          <Brand />
          <nav className="nav-links" aria-label="Principal">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="nav-spacer" />
          {email && (
            <div className="menu-wrap" ref={menuRef}>
              <button
                type="button"
                className="avatar-btn"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="Menú de cuenta"
                onClick={() => setOpen((v) => !v)}
              >
                {initial}
              </button>
              {open && (
                <div className="menu" role="menu">
                  <div className="menu-email" title={email}>
                    {email}
                  </div>
                  <Link role="menuitem" href="/account" onClick={() => setOpen(false)}>
                    Cuenta y plan
                  </Link>
                  <Link role="menuitem" href="/pricing" onClick={() => setOpen(false)}>
                    Precios
                  </Link>
                  <button role="menuitem" type="button" className="danger" onClick={() => void signOut()}>
                    Cerrar sesión
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>
      {(title || subtitle || actions) && (
        <div className="page-head">
          <div>
            {title && <h1>{title}</h1>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
    </>
  );
}
