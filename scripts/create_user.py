#!/usr/bin/env python
"""Crea (o actualiza la contrasena de) un usuario de la app en Supabase Auth.

Uso:
    python scripts/create_user.py correo@ejemplo.com "contrasena segura"

Usa la clave secreta del .env (admin). Los usuarios quedan confirmados.
"""

from __future__ import annotations

import sys


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    email, password = sys.argv[1], sys.argv[2]

    from piano_worker.cloud import get_client

    admin = get_client().auth.admin
    existing = [u for u in admin.list_users() if (u.email or "").lower() == email.lower()]
    if existing:
        admin.update_user_by_id(existing[0].id, {"password": password, "email_confirm": True})
        print(f"Contrasena actualizada: {email}")
    else:
        admin.create_user({"email": email, "password": password, "email_confirm": True})
        print(f"Usuario creado: {email}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
