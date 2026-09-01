import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Piano Tutorial",
  description: "Tutorial de piano local-first con notas que caen",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#0e0e14" }}>{children}</body>
    </html>
  );
}
