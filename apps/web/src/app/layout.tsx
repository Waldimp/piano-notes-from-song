import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import AuthGate from "@/components/AuthGate";
import { SITE_DESCRIPTION, SITE_NAME, SITE_OG, SITE_TITLE } from "@/lib/site";

export const metadata: Metadata = {
  title: {
    default: SITE_TITLE,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_OG.title,
    description: SITE_OG.description,
    type: SITE_OG.type,
    siteName: SITE_NAME,
  },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: SITE_NAME },
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
