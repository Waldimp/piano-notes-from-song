#!/usr/bin/env python
"""Configure Supabase Auth to send email through Resend (production SMTP).

Why: the built-in Supabase mailer is development-only (2 emails/hour, and
delivery to arbitrary recipients is not guaranteed). Custom SMTP removes that
limit and unlocks branded email templates.

Prerequisites (one-time, human):
  1. https://resend.com -> create account -> Domains -> add YOUR domain and
     publish the DNS records it shows (SPF/DKIM). Resend cannot send from
     *.vercel.app; you need a domain you own (e.g. pianissimo.app).
  2. Resend -> API Keys -> create a key with "Sending access".
  3. Supabase -> Account -> Access Tokens -> personal token (sbp_...).

Env (put them in .env.local, never commit):
  SUPABASE_ACCESS_TOKEN=sbp_...
  RESEND_API_KEY=re_...
  AUTH_SENDER_EMAIL=hola@tudominio.com      # must belong to the verified domain
  AUTH_SENDER_NAME=Pianissimo               # optional

Usage:
  python scripts/production-canary/configure_auth_smtp.py --check   # show current SMTP state
  python scripts/production-canary/configure_auth_smtp.py --apply   # configure Resend + templates
  python scripts/production-canary/configure_auth_smtp.py --revert  # back to built-in mailer

The script never prints secrets.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import httpx

PROJECT_REF = "epapmenfnyfqdfmsgfee"
API = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/config/auth"
SITE_URL = "https://piano-notes-from-song.vercel.app"

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_env() -> None:
    try:
        from dotenv import load_dotenv

        load_dotenv(REPO_ROOT / ".env.local")
        load_dotenv(REPO_ROOT / ".env")
    except ImportError:
        pass


def _template(title: str, lead: str, cta: str, href: str) -> str:
    return f"""<div style="background:#100d0b;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#f4ede3">
  <div style="max-width:520px;margin:0 auto;background:#1c1713;border:1px solid rgba(255,232,205,.12);border-radius:20px;padding:32px">
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#e8b45a;font-weight:700">Pianissimo</p>
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:600;color:#f4ede3">{title}</h1>
    <p style="margin:0 0 24px;color:#d9cdbf;line-height:1.55">{lead}</p>
    <a href="{href}" style="display:inline-block;background:#e8b45a;color:#241a08;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:999px">{cta}</a>
    <p style="margin:24px 0 0;font-size:12px;color:#a4937f">Si no fuiste tú, ignora este correo. El enlace caduca en 1 hora.</p>
  </div>
</div>"""


TEMPLATES = {
    "mailer_subjects_confirmation": "Confirma tu cuenta en Pianissimo",
    "mailer_templates_confirmation_content": _template(
        "Bienvenido a Pianissimo",
        "Confirma tu correo para empezar a crear tutoriales de piano a partir de tus canciones.",
        "Confirmar mi cuenta",
        "{{ .ConfirmationURL }}",
    ),
    "mailer_subjects_recovery": "Cambia tu contraseña de Pianissimo",
    "mailer_templates_recovery_content": _template(
        "Nueva contraseña",
        "Recibimos una solicitud para cambiar tu contraseña. Pulsa el botón para elegir una nueva.",
        "Cambiar contraseña",
        "{{ .ConfirmationURL }}",
    ),
    "mailer_subjects_magic_link": "Tu acceso a Pianissimo",
    "mailer_templates_magic_link_content": _template(
        "Entrar a Pianissimo",
        "Pulsa el botón para entrar sin contraseña.",
        "Entrar",
        "{{ .ConfirmationURL }}",
    ),
    "mailer_subjects_email_change": "Confirma tu nuevo correo en Pianissimo",
    "mailer_templates_email_change_content": _template(
        "Confirmar nuevo correo",
        "Confirma que quieres usar este correo para tu cuenta de Pianissimo.",
        "Confirmar correo",
        "{{ .ConfirmationURL }}",
    ),
}


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def check(token: str) -> int:
    r = httpx.get(API, headers=_headers(token), timeout=30)
    r.raise_for_status()
    cfg = r.json()
    view = {
        "smtp_host": cfg.get("smtp_host"),
        "smtp_port": cfg.get("smtp_port"),
        "smtp_user": cfg.get("smtp_user"),
        "smtp_admin_email": cfg.get("smtp_admin_email"),
        "smtp_sender_name": cfg.get("smtp_sender_name"),
        "rate_limit_email_sent": cfg.get("rate_limit_email_sent"),
        "mailer_autoconfirm": cfg.get("mailer_autoconfirm"),
        "disable_signup": cfg.get("disable_signup"),
        "site_url": cfg.get("site_url"),
        "custom_smtp_active": bool(cfg.get("smtp_host")),
    }
    print(json.dumps(view, indent=2))
    return 0


def apply(token: str) -> int:
    api_key = os.environ.get("RESEND_API_KEY", "")
    sender = os.environ.get("AUTH_SENDER_EMAIL", "")
    name = os.environ.get("AUTH_SENDER_NAME", "Pianissimo")
    if not api_key.startswith("re_") or "@" not in sender:
        print("Faltan RESEND_API_KEY (re_...) y/o AUTH_SENDER_EMAIL (correo del dominio verificado).", file=sys.stderr)
        return 2
    payload = {
        "smtp_host": "smtp.resend.com",
        "smtp_port": "465",
        "smtp_user": "resend",
        "smtp_pass": api_key,
        "smtp_admin_email": sender,
        "smtp_sender_name": name,
        "smtp_max_frequency": 1,
        # Custom SMTP: Supabase allows raising the hourly cap (default 30 with custom SMTP).
        "rate_limit_email_sent": 200,
        "site_url": SITE_URL,
        **TEMPLATES,
    }
    r = httpx.patch(API, headers=_headers(token), json=payload, timeout=60)
    if r.status_code >= 300:
        print("Supabase rechazó la configuración:", r.status_code, r.text[:300], file=sys.stderr)
        return 1
    print("SMTP de Resend configurado y plantillas de Pianissimo aplicadas.")
    return check(token)


def revert(token: str) -> int:
    payload = {"smtp_host": "", "smtp_port": "", "smtp_user": "", "smtp_pass": "", "smtp_admin_email": "", "smtp_sender_name": ""}
    r = httpx.patch(API, headers=_headers(token), json=payload, timeout=60)
    if r.status_code >= 300:
        print("No se pudo revertir:", r.status_code, r.text[:300], file=sys.stderr)
        return 1
    print("Vuelto al correo integrado de Supabase (solo desarrollo).")
    return check(token)


def main() -> int:
    _load_env()
    parser = argparse.ArgumentParser(description="Supabase Auth SMTP via Resend")
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("--check", action="store_true")
    g.add_argument("--apply", action="store_true")
    g.add_argument("--revert", action="store_true")
    args = parser.parse_args()
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token.startswith("sbp_"):
        print("Falta SUPABASE_ACCESS_TOKEN (token personal sbp_...).", file=sys.stderr)
        return 2
    if args.check:
        return check(token)
    if args.apply:
        return apply(token)
    return revert(token)


if __name__ == "__main__":
    sys.exit(main())
