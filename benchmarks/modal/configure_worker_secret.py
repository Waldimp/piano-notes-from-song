"""Crea el Modal Secret del POC leyendo sólo dos claves de .env.

No imprime ni persiste los valores.
"""

from pathlib import Path

import modal
from dotenv import dotenv_values


SECRET_NAME = "piano-modal-worker-poc-supabase"
REPO_ROOT = Path(__file__).resolve().parents[2]
REQUIRED_KEYS = ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")


def main() -> int:
    values = dotenv_values(REPO_ROOT / ".env")
    selected = {key: str(values.get(key) or "") for key in REQUIRED_KEYS}
    missing = [key for key, value in selected.items() if not value]
    if missing:
        raise RuntimeError("Faltan claves requeridas en .env: " + ", ".join(missing))
    modal.Secret.objects.create(SECRET_NAME, selected, allow_existing=True)
    print(f"Secret listo: {SECRET_NAME}; claves: {', '.join(REQUIRED_KEYS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
