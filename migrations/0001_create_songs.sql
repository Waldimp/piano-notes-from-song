-- Biblioteca local de canciones transcritas (SQLite).
-- El id coincide con el nombre de la carpeta en data/output/.
CREATE TABLE IF NOT EXISTS songs (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    filename    TEXT NOT NULL,
    duration    REAL NOT NULL DEFAULT 0,
    note_count  INTEGER NOT NULL DEFAULT 0,
    pedal_count INTEGER NOT NULL DEFAULT 0,
    engine      TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
