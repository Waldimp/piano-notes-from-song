#!/usr/bin/env python
"""Runner de migraciones minimo para la biblioteca local (SQLite).

Aplica en orden los .sql de migrations/ que no esten registrados en la tabla
_migrations. Idempotente: correrlo dos veces no hace nada la segunda.

Uso:
    python scripts/migrate.py            # aplica pendientes a data/library.db
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = REPO_ROOT / "data" / "library.db"
MIGRATIONS_DIR = REPO_ROOT / "migrations"


def apply_migrations(db_path: Path = DB_PATH) -> list[str]:
    """Aplica las migraciones pendientes; devuelve los nombres aplicados."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    applied: list[str] = []
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS _migrations ("
            "name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
        )
        done = {row[0] for row in conn.execute("SELECT name FROM _migrations")}
        for sql_file in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if sql_file.name in done:
                continue
            conn.executescript(sql_file.read_text(encoding="utf-8"))
            conn.execute("INSERT INTO _migrations (name) VALUES (?)", (sql_file.name,))
            applied.append(sql_file.name)
        conn.commit()
    return applied


if __name__ == "__main__":
    applied = apply_migrations()
    if applied:
        print("Migraciones aplicadas:", ", ".join(applied))
    else:
        print("Base de datos al dia (sin migraciones pendientes).")
    sys.exit(0)
