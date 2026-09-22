/** Branding and public site config (safe for client + server). */

export const SITE_NAME = "Pianissimo";

export const SITE_TAGLINE = "Aprende cualquier canción de piano";

export const SITE_TITLE = "Pianissimo — Learn Any Piano Song";

export const SITE_DESCRIPTION =
  "AI-powered piano transcription and interactive tutorials.";

export const SITE_OG = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  type: "website" as const,
};

/** Support contact — set NEXT_PUBLIC_SUPPORT_EMAIL in env (no personal hardcode). */
export function supportEmail(): string | null {
  const v =
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() ||
    process.env.SUPPORT_EMAIL?.trim() ||
    "";
  return v.length > 0 ? v : null;
}

export function supportMailto(): string | null {
  const email = supportEmail();
  return email ? `mailto:${email}` : null;
}

export const SUPPORT_EMAIL_PLACEHOLDER =
  "Configura NEXT_PUBLIC_SUPPORT_EMAIL para mostrar contacto de soporte.";
