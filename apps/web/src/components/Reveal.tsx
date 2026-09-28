"use client";

/**
 * Aparición al hacer scroll: añade `.in` cuando el elemento entra en el
 * viewport (IntersectionObserver). La animación es CSS; con
 * prefers-reduced-motion el CSS la desactiva. Sin scroll-jacking.
 */

import { type CSSProperties, type JSX, type ReactNode, useEffect, useRef, useState } from "react";

type Props = {
  children: ReactNode;
  as?: keyof JSX.IntrinsicElements;
  className?: string;
  /** Retardo escalonado en ms (para listas). */
  delay?: number;
  /** Umbral de visibilidad 0–1. */
  threshold?: number;
  style?: CSSProperties;
  id?: string;
};

export default function Reveal({ children, as = "div", className = "", delay = 0, threshold = 0.18, style, id }: Props) {
  const ref = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            io.disconnect();
          }
        }
      },
      { threshold, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  const Tag = as as unknown as "div";
  return (
    <Tag
      id={id}
      ref={ref as unknown as React.RefObject<HTMLDivElement>}
      className={`reveal${inView ? " in" : ""}${className ? ` ${className}` : ""}`}
      style={{ ...style, transitionDelay: delay ? `${delay}ms` : undefined }}
    >
      {children}
    </Tag>
  );
}
