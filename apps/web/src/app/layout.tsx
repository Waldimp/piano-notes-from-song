import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import AuthGate from "@/components/AuthGate";

export const metadata: Metadata = {
  title: "Piano Tutorial",
  description: "Tutorial de piano local-first con notas que caen",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Piano" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0e0e14",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
