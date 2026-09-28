import type { Metadata, Viewport } from "next";
import { Fraunces, Manrope } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";
import AuthGate from "@/components/AuthGate";
import { SITE_DESCRIPTION, SITE_NAME, SITE_OG, SITE_TITLE } from "@/lib/site";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
});

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
  themeColor: "#100d0b",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${manrope.variable} ${fraunces.variable}`}>
      <body>
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
