import type { Metadata, Viewport } from "next";
import { Dancing_Script, Quicksand } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";
import AuthGate from "@/components/AuthGate";
import { SITE_DESCRIPTION, SITE_NAME, SITE_OG, SITE_TITLE } from "@/lib/site";

const quicksand = Quicksand({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-quicksand",
  display: "swap",
});

const dancing = Dancing_Script({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dancing",
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
  appleWebApp: { capable: true, statusBarStyle: "default", title: SITE_NAME },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f3ea",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${quicksand.variable} ${dancing.variable}`}>
      <body>
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
