# Modal Worker POC

Prueba aislada de un único request explícito de Supabase en Modal T4. No hace
polling, no reclama el job más antiguo y no modifica el worker local.

## Garantías

- `request_id` UUID obligatorio; no existe modo sin ID.
- Consulta y claim exclusivamente por ese ID.
- Claim atómico sólo desde `queued`.
- `retries=0`, `min_containers=0`, `max_containers=1` y
  `scaledown_window=2`.
- Una sola llamada remota por ejecución.
- Secret con sólo `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.
- Ningún valor secreto, URL firmada o ruta privada se imprime.
- Directorio temporal eliminado al terminar.
- ID de canción aislado: `<slug>_modal_poc_<8 caracteres del request>` para no
  sobrescribir una publicación existente.

## Configurar el Secret

El configurador lee únicamente dos claves de `.env`, las envía directamente a
Modal y no guarda ni imprime sus valores:

```powershell
benchmarks/modal/.venv/Scripts/python.exe -m pip install -r `
  benchmarks/modal/requirements.txt
benchmarks/modal/.venv/Scripts/python.exe `
  benchmarks/modal/configure_worker_secret.py
```

## Preflight obligatorio

Antes de reservar GPU:

1. recibir el UUID explícito del request de prueba;
2. comprobar por ID que existe y está `queued`;
3. confirmar que el worker local no está ejecutándose;
4. confirmar cero contenedores GPU activos y revisar billing;
5. verificar que no existe aún el `song_id` determinista del POC.

La comprobación de Supabase es de sólo lectura y exige el UUID:

```powershell
.venv/Scripts/python.exe benchmarks/modal/preflight_worker_poc.py `
  --request-id <UUID-EXPLICITO>
```

## Ejecutar una sola vez

```powershell
benchmarks/modal/.venv/Scripts/modal.exe run `
  benchmarks/modal/worker_poc.py `
  --request-id <UUID-EXPLICITO>
```

El resultado se guarda en `benchmarks/modal/worker_poc_result.json`.
La evidencia de la ejecución controlada está en
[`WORKER_POC_RESULT.md`](WORKER_POC_RESULT.md).

## Flujo

```text
request UUID explícito
  -> SELECT exacto por ID
  -> claim atómico queued -> processing
  -> descarga desde uploads
  -> pipeline actual en T4
  -> publish_song actual (audio + notes + fila songs)
  -> descarga y validación del notes.json publicado
  -> request processing -> done
  -> eliminación del upload original
  -> limpieza de temporales y apagado de la app efímera
```

## Recuperación

Si falla después del claim, el request queda en `error` con un mensaje
redactado. No se reintenta automáticamente y una segunda ejecución no lo
procesa porque ya no está `queued`. Los efectos distribuidos entre Storage y
Postgres no forman una transacción; cualquier residuo se inspecciona y limpia
manualmente antes de autorizar otra prueba.
