# Diseño de migración controlada del worker a Modal T4

Estado: hardening local aprobado por seguridad; staging y producción en NO-GO operativo
Fecha: 2026-09-19
Decisión de referencia: DEC-008
Evidencia: [`WORKER_POC_RESULT.md`](../benchmarks/modal/WORKER_POC_RESULT.md)

## 1. Resumen ejecutivo

Se propone reemplazar gradualmente la ejecución ordinaria del worker local por
una función Modal T4 invocada **siempre con un `request_id` explícito**. Supabase
continúa siendo la fuente de verdad para la cola, estados, metadata y Storage.
No se introduce R2 en esta fase.

El diseño usa entrega al menos una vez en el plano de control y efectos
efectivamente una vez en el plano de datos. No promete “exactly once” de red,
que no es alcanzable entre Supabase, Modal y Storage; lo obtiene de manera
operativa mediante claims condicionales, leases, IDs deterministas, propiedad
de artefactos y finalización transaccional.

Revisión de seguridad final del 2026-09-19: **GO para el hardening local;
NO-GO operativo para desplegar o ejecutar staging y NO-GO para producción**.
La siguiente autorización, todavía pendiente, se limitará a crear un proyecto
Supabase temporal vacío y un Modal Environment vacío para obtener y revisar sus
identificadores reales. No permitirá migraciones, Edge Functions, secrets
funcionales, GPU, jobs ni tráfico de producción. Un canary de producción siempre
requerirá otra revisión explícita.

## 2. Alcance y principios

Incluido en el diseño:

- despacho por UUID;
- una sola GPU T4 concurrente;
- claims, leases, reintentos controlados e idempotencia;
- publicación compensable en los buckets actuales `uploads`, `audio` y
  `notes`;
- observabilidad, límites de gasto, kill switch y rollback;
- convivencia excluyente con el worker local.

Fuera de alcance:

- R2, cambios de frontend, pricing, créditos o rate limiting;
- optimizaciones del modelo;
- polling continuo dentro de un contenedor GPU;
- múltiples GPUs o autoscaling mayor que uno;
- aplicación de migraciones o activación de tráfico en esta fase.

Principios:

1. Supabase es la fuente de verdad; la memoria de un proceso nunca lo es.
2. Ningún consumidor elige “el job más antiguo” y lo procesa directamente. El
   dispatcher entrega un UUID y el worker sólo puede reclamar ese UUID.
3. Un redelivery debe ser inocuo.
4. Ningún objeto se sobrescribe si pertenece a otro request.
5. El source upload se conserva hasta que la publicación esté confirmada y
   haya vencido una ventana de recuperación.
6. `min_containers=0` es obligatorio inicialmente.

## 3. Arquitectura y propietario del dispatcher

El propietario propuesto es una **Supabase Edge Function
`dispatch-modal-request`**, ejecutada con credenciales de servidor. No es el
frontend, el navegador, el worker local ni la función GPU.

La Edge Function recibe eventos de una outbox transaccional y sólo envía a
Modal el UUID, un `dispatch_id` y el número de intento. Un Database Webhook
puede despertarla inmediatamente; un reconciliador CPU de baja frecuencia es
la red de seguridad para eventos perdidos. Ese reconciliador no ejecuta GPU ni
hace polling continuo de trabajo: inspecciona únicamente outbox vencida o
leases expirados, con lote y frecuencia acotados.

El frontend mantiene el flujo actual de upload + creación de request. Un
trigger de base de datos crea la fila de outbox en la misma transacción que el
request, de modo que cerrar el navegador no pierde el despacho.

### Endpoint Modal, Proxy Auth y ACK

El dispatcher llama una Web Function Modal dedicada, no la función GPU de
forma pública. El endpoint se declara con
`@modal.fastapi_endpoint(requires_proxy_auth=True)` y rechaza cualquier request
sin Modal Proxy Auth. La Edge Function conserva un Proxy Token (Token ID +
Token Secret) y lo envía como headers `Modal-Key` y `Modal-Secret`; no se usa
un bearer propio ni una URL secreta como sustituto de autenticación. El Proxy
Token queda asociado exclusivamente al Modal Environment de destino. Referencia:
[`Proxy Tokens`](https://modal.com/docs/guide/webhook-proxy-auth).

Payload mínimo autenticado:

```text
request_id, dispatch_id, attempt_no, worker_generation
```

`dispatch_id` es estable durante todos los redeliveries del mismo despacho. La
semántica es:

- `202 Accepted`: payload válido, `dispatch_id` registrado de forma durable y
  llamada GPU aceptada por Modal. Incluye `dispatch_id` y `modal_call_id`. No
  significa claim ni procesamiento completado.
- `200 OK` de replay: el `dispatch_id` ya había sido aceptado; devuelve el
  receipt conocido y **no** crea otra llamada GPU.
- `409 Conflict`: generación, intento o estado obsoleto; el dispatcher no crea
  un intento nuevo y reconcilia desde DB. Cierra ese item sólo si el request ya
  está `processing`, `done` o `error`; si sigue `queued` y elegible bajo la
  generación vigente, crea/activa el item correspondiente a esa generación.
- `401/403`: Proxy Auth inválido o no autorizado; se pausa el dispatcher y se
  alerta. No se produce una tormenta de retries.
- `429/503`, timeout de red o respuesta 5xx: no existe ACK concluyente. Se
  redelivera el mismo `dispatch_id` con backoff; nunca se incrementa
  `attempt_no` por un fallo de transporte.

Antes de lanzar GPU, el endpoint registra/consulta el receipt por
`dispatch_id`. Sólo el primer receipt puede hacer spawn. Si ocurre el caso
ambiguo “spawn aceptado pero ACK perdido”, un redelivery puede llegar mientras
se reconcilia; el receipt durable evita otro spawn cuando el `modal_call_id` ya
se guardó y, como última defensa, el claim impide efectos duplicados. Esta
ventana se mide como `dispatch_ack_ambiguous_total`.

Un intento nuevo sólo nace después de que el intento anterior quedó
formalmente `failed` o `lost`, su lease venció, se ejecutó compensación y el
control plane incrementó `attempt_no`. Redelivery y retry son conceptos
distintos.

### Flujo textual

```text
Usuario autenticado
  -> upload privado en Supabase Storage /uploads
  -> INSERT requests(status=queued, target_song_id único)
       -> trigger: INSERT dispatch_outbox(request_id, pending)
       -> Database Webhook despierta Edge Function

Edge Function (dispatcher propietario)
  -> lee worker_control
  -> valida mode=modal, kill_switch=false y presupuesto disponible
  -> adquiere el único slot de despacho + lease de outbox
  -> invoca Web Function Modal protegida por Proxy Auth
     con request_id explícito, dispatch_id, intento y generation
  -> registra ACK 202 o replay 200; conserva el mismo dispatch_id si es ambiguo

Modal T4 (un input concurrente)
  -> RPC claim_request(request_id, worker=modal, lease_token)
  -> descarga source desde /uploads
  -> transcribe y genera artefactos en temporal local
  -> sube artefactos a staging por request/intento
  -> valida contrato, tamaños y hashes
  -> promueve a rutas canónicas propiedad del request
  -> RPC finalize_request(...) en una transacción DB
  -> marca outbox/attempt como succeeded y libera slot
  -> agenda limpieza diferida del source y staging

Evento de finalización
  -> despierta dispatcher para el siguiente UUID pendiente
```

No se deben encolar por adelantado decenas de llamadas Modal: mientras exista
un slot activo, los demás requests permanecen en la outbox. Esto permite que el
kill switch y el presupuesto detengan trabajo todavía no reservado.

## 4. Máquina de estados

### Estado público del request

```text
queued
  -> processing
       -> done
       -> queued (sólo tras fallo transitorio compensado; next_attempt_at futuro)
       -> error
```

- `queued`: upload disponible; sólo es elegible cuando
  `next_attempt_at IS NULL OR next_attempt_at <= now()`.
- `processing`: existe exactamente un lease vigente y un intento activo.
- `done`: metadata y artefactos canónicos fueron verificados y confirmados.
- `error`: fallo permanente o presupuesto de intentos agotado.

El contrato web y el check público se mantienen exactamente en
`queued | processing | done | error`. **No se añade `retry_wait` a
`requests.status`**. Tras un fallo transitorio, una RPC atómica cierra el
intento como `retry_scheduled`, elimina el lease, devuelve el request a
`queued`, fija `next_attempt_at` y crea/actualiza la outbox con `available_at`.
El frontend actual continúa mostrando “En cola”; el dispatcher no lo considera
elegible antes de esa fecha. Los estados `retry_scheduled`, `lost` y
`compensating` existen únicamente en `request_attempts`/`dispatch_outbox`.

El estado de despacho (`pending`, `leased`, `sent`, `acknowledged`, `closed`)
vive en `dispatch_outbox`, no se mezcla con el estado visible del request.

### Claim y lease

`claim_request(request_id, worker_kind, dispatch_id, attempt_no)` será una RPC
transaccional `SECURITY DEFINER` con permisos restringidos. Sólo tendrá éxito
si se cumplen simultáneamente estas condiciones:

- el UUID coincide exactamente;
- `requests.status = 'queued'`;
- `next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp()`;
- `worker_control.mode = worker_kind`;
- `kill_switch = false`;
- no hay lease activo para ese request;
- el intento coincide con el siguiente número esperado;
- el request no tiene una canción ya confirmada.

La RPC cambia a `processing`, incrementa `attempt_count`, crea
`request_attempts`, asigna un `lease_token` aleatorio y devuelve sólo los datos
necesarios. Todo heartbeat, finalización o fallo posterior exige UUID,
`attempt_id` y `lease_token`; un proceso viejo no puede cerrar el intento de
otro.

El worker local deberá usar la misma RPC con `worker_kind='local'`. Mantener su
UPDATE actual como una segunda vía dejaría una carrera y es criterio No-Go.

## 5. Idempotencia y colisiones de `song_id`

El `song_id` no se volverá a derivar únicamente del nombre del archivo ni del
estado del filesystem local. Al crear el request se reserva un
`target_song_id` globalmente único y estable, por ejemplo:

```text
<slug-legible>_<UUID-completo-del-request>
```

La longitud puede compactarse con un UUID codificado, pero no debe truncarse a
ocho caracteres. El título visible permanece separado del ID.

Se propone añadir `songs.request_id UUID UNIQUE`. La finalización sólo puede:

- insertar el `song_id` reservado; o
- reconocer como idempotente una fila con el mismo `request_id`, mismo contrato
  y mismos hashes.

Un conflicto con otro `request_id` es permanente: no se hace `upsert` ciego,
no se renombra sobre la marcha y no se sobrescriben objetos. Esto resuelve
colisiones entre Modal, el worker local y redeliveries.

Cada intento usa rutas de staging deterministas y aisladas:

```text
audio/_staging/<request_id>/<attempt_id>/playback.m4a
notes/_staging/<request_id>/<attempt_id>/notes.json
```

Las rutas canónicas pertenecen al request:

```text
audio/<target_song_id>/playback.m4a
notes/<target_song_id>/notes.json
```

### Aislamiento RLS de `_staging`

Los buckets siguen privados, pero la policy actual permite leer `audio` y
`notes` a cualquier usuario autenticado. Por tanto, antes de usar staging se
deben reemplazar las policies de SELECT y DELETE para excluir expresamente
cualquier objeto cuyo primer segmento sea `_staging`:

```sql
-- Propuesta; no aplicada por este documento.
using (
  bucket_id in ('audio', 'notes')
  and split_part(name, '/', 1) <> '_staging'
)
```

La condición debe existir tanto en lectura como en borrado autenticado. No se
crea policy de INSERT/UPDATE autenticada sobre `_staging`, no se generan signed
URLs para esas rutas y ninguna consulta del frontend las devuelve. El worker
server-side accede con service-role, que omite RLS, y toda operación staging se
autoriza adicionalmente por ownership en `request_artifacts`. Las pruebas deben
cubrir SELECT, list, download, signed URL y DELETE con un JWT autenticado y
confirmar denegación para `_staging`, sin romper acceso a rutas canónicas.

## 6. Publicación y compensación

Storage y PostgreSQL no comparten una transacción. Se propone una saga corta:

1. **Preparar:** descargar el source, transcribir y generar artefactos locales.
2. **Stage:** subir con `upsert=false` a rutas del intento y registrar tamaño,
   hash SHA-256 y tipo en `request_artifacts`.
3. **Validar:** volver a leer metadata/JSON; comprobar contrato v1, duración,
   conteos y hashes.
4. **Promover:** copiar/subir a rutas canónicas únicamente si el ownership del
   request sigue vigente.
5. **Finalizar:** `finalize_request` inserta `songs`, marca artefactos committed,
   cambia el request a `done` y cierra el intento/outbox en una sola transacción
   PostgreSQL condicionada por el lease.
6. **Limpiar:** borrar staging del intento. El source de `uploads` se elimina
   mediante cleanup diferido después de una ventana inicial de 24 horas.

### Matriz de recuperación

| Punto de fallo | Estado observable | Acción segura |
|---|---|---|
| Antes del claim | `queued` | Redelivery normal; ningún efecto que compensar |
| Después del claim, antes de stage | lease activo o vencido | Expirar intento y reintentar si corresponde |
| Stage parcial | artefactos del intento | Borrar sólo el prefijo de ese intento |
| Canónico parcial, sin fila `songs` | ownership registrado, request no `done` | Validar y completar o borrar sólo objetos del mismo request |
| `songs` + `done` confirmados, ACK perdido | request `done` | Tratar redelivery como éxito; no reprocesar |
| `songs` existe con otro request | conflicto de ownership | Error permanente y alerta; nunca sobrescribir |
| Limpieza del source falla | request `done`, cleanup pendiente | Reintento CPU; no volver a ejecutar GPU |

La compensación nunca hace listados/borrados por slug general. Opera por
`request_id`, `attempt_id` y filas de ownership. Los errores guardados son
códigos y mensajes sanitizados, sin tokens, URLs firmadas ni rutas privadas.

## 7. Timeouts, heartbeats y política de fallos

Valores iniciales propuestos, sujetos a prueba en staging:

| Control | Valor inicial |
|---|---:|
| Timeout Modal por intento | 10 minutos |
| Lease de procesamiento | 12 minutos |
| Heartbeat | cada 30 segundos |
| Umbral de job atascado | 15 minutos sin heartbeat |
| ACK del dispatcher | 10 segundos |
| Máximo de intentos | 2 totales |
| Backoff del segundo intento | 60 segundos + jitter |
| Reconciliación CPU | cada 5 minutos, lote máximo 20 |
| Retención inicial del source | 24 horas después de `done` |

`retries=0` permanece en Modal. Los reintentos pertenecen al control plane y
quedan registrados; no habrá reintentos invisibles de plataforma.

Fallos transitorios elegibles para un segundo intento:

- indisponibilidad o timeout de red de Supabase/Modal;
- pérdida del contenedor antes de finalizar;
- error 5xx temporal de Storage;
- lease vencido sin publicación confirmada.

Fallos permanentes sin retry automático:

- audio inválido/no decodificable;
- checkpoint/hash incorrecto;
- contrato de salida inválido;
- colisión de ownership;
- objeto source ausente;
- validación de tamaño/duración rechazada;
- error de autorización o secret faltante.

El reconciliador primero consulta el estado DB. Si ya está `done`, sólo cierra
outbox. Si está `processing` con lease vencido, marca el intento `lost`, ejecuta
la compensación conocida y lo devuelve a `queued` con `next_attempt_at` o lo
lleva a `error`. Nunca lanza otra GPU mientras el lease anterior siga vigente.

## 8. Convivencia y exclusión mutua con el worker local

Se propone una fila singleton `worker_control`:

```text
mode: local | modal | paused
kill_switch: boolean
generation: bigint
changed_at / changed_by / reason
```

Reglas:

- sólo la RPC de claim interpreta el modo; ningún worker puede ignorarlo;
- el dispatcher sólo actúa en `mode=modal`;
- `Procesar ahora`, el listener local y `scripts/worker.py` sólo reclaman en
  `mode=local`;
- `mode=paused` impide nuevos claims en ambos lados;
- cada cambio incrementa `generation`; un dispatcher antiguo no puede usar una
  autorización de la generación anterior;
- un request ya `processing` termina o se recupera antes de cambiar de modo.

Procedimiento de cambio local -> Modal:

1. deshabilitar las fuentes de nuevos claims locales: apagar listener,
   bloquear “Procesar ahora” y detener `scripts/worker.py`;
2. esperar que el intento vigente termine o reconciliarlo; confirmar cero
   leases activos;
3. invocar `set_worker_mode(expected_generation, 'paused', reason)`;
4. verificar Modal `min_containers=0`, `max_containers=1`, Proxy Auth y kill
   switch sano;
5. invocar `set_worker_mode(expected_generation, 'modal', reason)` usando la
   generación devuelta por el paso anterior;
6. habilitar únicamente un canary explícito.

No se permite un modo híbrido inicial.

### RPC restringida `set_worker_mode`

Los cambios de modo no se realizan con UPDATE directo. Se propone:

```text
set_worker_mode(
  expected_generation bigint,
  new_mode worker_mode,
  reason text
) -> {mode, generation, changed_at}
```

Propiedades obligatorias:

1. `SECURITY DEFINER SET search_path = pg_catalog`; todas las tablas, tipos y
   funciones se referencian con schema explícito (`public.worker_control`,
   `public.requests`, etc.). No se admite un schema escribible por usuarios en
   `search_path`.
2. La función pertenece a un rol NOLOGIN dedicado `worker_control_owner`, no a
   un rol expuesto por PostgREST. `REVOKE ALL ... FROM PUBLIC, anon,
   authenticated, service_role`; `EXECUTE` se concede sólo a una
   credencial/rol de control independiente `worker_control_admin`, nunca al
   Secret usado por Modal. También se revoca INSERT/UPDATE/DELETE directo sobre
   `worker_control` y `worker_control_events` a `PUBLIC`, `anon`,
   `authenticated` y `service_role`; el cambio sólo atraviesa la RPC. Si
   PostgREST no puede representar ese rol con garantías, se usa una conexión
   administrativa server-side dedicada, no se relaja la ACL.
3. La función bloquea la fila singleton `FOR UPDATE`. `claim_request` también
   debe bloquear/leer esa misma fila dentro de su transacción; así no puede
   aparecer un lease entre la comprobación y el cambio de modo.
4. Aplica compare-and-swap: si `expected_generation` no coincide, rechaza. En
   éxito incrementa `generation` exactamente una vez y devuelve el nuevo valor.
5. Sólo acepta transiciones `local <-> paused` y `modal <-> paused`; rechaza
   `local <-> modal` directo y no-ops accidentales.
6. Requiere `reason` no vacío y registra actor, modo anterior/nuevo,
   generación y timestamp en `worker_control_events`, dentro de la misma
   transacción.
7. **Rechaza cualquier cambio de modo si existe un lease activo**, definido
   por request `processing`, attempt activo y `lease_expires_at >
   clock_timestamp()`. También rechaza cualquier attempt `processing` no
   reconciliado aunque su lease ya haya vencido; primero debe cerrarse como
   `lost`, compensarse y quedar fuera de `processing`. No basta ignorarlo.

El kill switch de emergencia es una RPC separada,
`engage_worker_kill_switch(reason)`: puede activarse aun con leases vigentes,
incrementa `generation` e impide nuevos claims, pero no cambia `mode`, no roba
leases y no marca requests automáticamente. Limpiar el kill switch sí exige
`expected_generation`, cero leases activos, ACL administrativa y auditoría.
Esto conserva la regla estricta de `set_worker_mode` sin inutilizar la parada
de emergencia.

## 9. Configuración Modal y concurrencia

Configuración inicial obligatoria:

```text
gpu="T4"
min_containers=0
max_containers=1
container concurrency / max_inputs=1
retries=0
timeout=600 s
scaledown_window corto (2–10 s)
```

El slot DB limita a una invocación despachada. `max_containers=1` y
`max_inputs=1` son defensas adicionales, no el único mecanismo de exclusión.
No habrá contenedor warm permanente hasta que costo/latencia reales justifiquen
otra decisión.

## 10. Límites de gasto y kill switch

Controles propuestos para la primera canary/beta:

- reserva de costo antes de despachar cada intento;
- ledger interno por request con GPU-seconds y costo estimado/observado;
- máximo de una reserva activa;
- alerta diaria inicial a $0.50 y pausa diaria a $1.00;
- alerta acumulada del proyecto a $10;
- **hard stop del proyecto a $20**;
- límite absoluto de seguridad del workspace en $30, si Modal permite
  configurarlo en el nivel de cuenta;
- discrepancia >20% entre costo estimado y observado genera alerta y pausa de
  nuevos despachos.

El valor de `$20` es el umbral operativo: no se espera llegar a `$30`. Debido al
retraso del billing del proveedor, el dispatcher usa su ledger conservador y
reservas, no sólo el dashboard de Modal.

Kill switch por capas:

1. `worker_control.kill_switch=true` o `mode=paused`: detención lógica inmediata;
2. revocar/rotar el token de despacho: impide nuevas llamadas;
3. detener la app Modal: termina contenedores activos ante incidente;
4. revocar el Secret Supabase de Modal ante sospecha de credenciales.

Activar el hard kill no cambia jobs a `error` automáticamente. Quedan pausados
para diagnóstico y recuperación explícita.

## 11. Logs, métricas, alertas y trazabilidad

Todos los componentes emiten JSON estructurado con:

```text
timestamp, level, event, request_id, dispatch_id, attempt_id,
worker_kind, worker_generation, modal_call_id, model_version,
checkpoint_sha256, duration_ms, outcome, failure_code
```

No se registran service-role keys, JWT, URLs firmadas, contenido del audio,
`audio_path` completo ni payloads de usuario. Los IDs de lease se registran
sólo como hash corto no reutilizable.

Métricas mínimas:

- requests creados, despachados, reclamados, `done`, `error` y recuperados;
- queue wait, dispatch latency, cold start, model load, download, inference,
  publish y end-to-end (p50/p95);
- intentos por request, leases vencidos y compensaciones;
- GPU-seconds, costo por intento, costo por canción exitosa y costo desperdiciado;
- profundidad de outbox y edad del item más antiguo;
- contenedores/GPU activos y utilización del único slot;
- discrepancias entre DB, Storage y Modal.

Alertas iniciales:

- cualquier lease vencido o compensación fallida;
- request `processing` >15 minutos;
- request `queued`/outbox pendiente >10 minutos durante modo Modal;
- cualquier fallo inexplicado o dos fallos consecutivos durante los 5–8 canaries
  dirigidos;
- costo por canción >$0.03 o discrepancia de billing >20%;
- más de un contenedor/input activo;
- detección de secret/URL firmada en logs;
- hard stop de $20 o kill switch activado.

`request_id` es la clave de correlación humana y técnica en DB, dispatcher,
Modal, métricas y cleanup.

## 12. Secrets y checkpoint

### Secrets

Se proponen Modal Environments distintos: `staging` y `production`. Ambos serán
restringidos, sin cross-environment lookups en el código. Cada Environment
mantiene sus propias Apps, Secrets, Volume, endpoint y Proxy Token; una
credencial de staging nunca es válida ni se reutiliza en producción. Modal
documenta que los Environments aíslan recursos y resuelven Secrets dentro del
entorno actual por defecto: [`Environments`](https://modal.com/docs/guide/environments).

En cada Environment, Modal recibe un Secret propio (mismo nombre lógico o
nombres inequívocos por entorno) con sólo:

- `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY`.

`staging` apunta exclusivamente al proyecto Supabase de staging y `production`
al proyecto productivo. El deploy falla si `MODAL_ENVIRONMENT`, Supabase URL,
manifest del checkpoint o endpoint esperado no corresponden al mismo entorno.
No se permite `Secret.from_name(..., environment_name="production")` desde una
app de staging.

El dispatcher guarda por separado, en los secrets de su propio entorno:

- URL exacta del endpoint Modal de ese Environment;
- `MODAL_PROXY_TOKEN_ID`;
- `MODAL_PROXY_TOKEN_SECRET`.

Los Proxy Tokens son distintos, rotatorios y asociados únicamente al
Environment destino. El token del dispatcher no es el token de despliegue de
Modal y no concede administración del workspace. Ninguna credencial se incluye
en imagen, repositorio, argumentos CLI, resultados, payloads o logs. Ante
exposición se pausa el dispatcher, se rota el par y luego se diagnostica.

La service-role sigue siendo necesaria mientras Storage y RPCs no tengan una
credencial más limitada y, por definición, conserva privilegios amplios. El
riesgo se reduce aislándola en Modal, limitando el código a las RPCs y buckets
requeridos, rotándola y auditando que nunca aparezca en logs; no debe afirmarse
que RLS limita una service-role. La revisión de logs es criterio Go/No-Go.

### Checkpoint

- Volume Modal versionado y separado por entorno;
- nombre de versión + SHA-256 fijados en el release manifest;
- montaje de sólo lectura;
- validación del hash antes de cargar el modelo;
- despliegue falla cerrado si falta o no coincide;
- conservar la versión anterior para rollback;
- no auto-descargar el modelo en runtime.

El release manifest también fija versiones de Python, PyTorch,
`piano_transcription_inference` y contrato de salida.

## 13. Cambios propuestos, no aplicados

### Esquema Supabase

1. Extender `requests` con `target_song_id`, `attempt_count`, `max_attempts`,
   `next_attempt_at`, `worker_kind`, `lease_token`, `lease_expires_at`,
   `heartbeat_at`, `failure_code` y `trace_id`. El check de `status` conserva
   exactamente `queued | processing | done | error`.
2. Añadir `songs.request_id UUID UNIQUE REFERENCES requests(id)`.
3. Crear `request_attempts` para lifecycle, timings, Modal call ID, costos y
   resultado interno (`running`, `retry_scheduled`, `lost`, `succeeded`,
   `failed`) de cada intento.
4. Crear `request_artifacts` para ownership, bucket, ruta, hash, tamaño y estado
   staged/committed/cleaned.
5. Crear `dispatch_outbox` con `dispatch_id` único, estado, lease,
   `available_at`, ACK, `modal_call_id`, intentos de entrega y error sanitizado.
6. Crear `worker_control` singleton, `worker_control_events` inmutable y,
   opcionalmente, `cost_ledger`/reservas.
7. Reemplazar las policies autenticadas de `storage.objects` para excluir
   `_staging` en SELECT y DELETE; no conceder INSERT/UPDATE sobre staging.
8. Crear índices para outbox disponible, leases vencidos y requests por estado.
9. Crear RPCs restringidas: `claim_request`, `heartbeat_request`,
   `finalize_request`, `fail_request_attempt`, `acquire_dispatch_slot`,
   `release_dispatch_slot`, `set_worker_mode`, kill switch y operaciones de
   reconciliación.

Toda migración debe incluir `down` lógico o script de rollback y probarse en un
proyecto Supabase de staging. No se modifica `0001_init.sql`; se propone una
migración nueva y reversible.

### Código

1. Extraer del POC un endpoint Modal con `requires_proxy_auth=True` y un worker
   desplegable que sólo acepte UUID.
2. Separar transcripción, stage, validación, promoción, finalización y cleanup.
3. Sustituir `publish_song` con upsert ciego por publicación con ownership.
4. Cambiar el claim local para usar la misma RPC y `worker_kind='local'`.
5. Hacer que panel/listener local respeten `worker_control`.
6. Implementar Edge Function dispatcher, receipts/ACK idempotentes y
   reconciliador CPU acotado.
7. Añadir logging estructurado, métricas, ledger y sanitización central.
8. Añadir pruebas de concurrencia, redelivery y fallos inyectados.

No se propone cambio de frontend para el primer canary. Cualquier ajuste del
texto “computadora con GPU” se hará después y por separado.

## 14. Secuencia de implementación propuesta

El hardening local superó la revisión de seguridad el 2026-09-19. La secuencia
remota continúa sin autorización. El siguiente paso propuesto se limita a
provisionar identidad vacía para staging temporal; no permite aplicar esta
migración, desplegar funciones, cargar secrets funcionales, ejecutar GPU,
procesar jobs ni acceder a recursos de producción.

1. **Aprobar diseño y threat/failure review.** Congelar estados, ownership,
   timeouts y umbrales.
2. **Staging Supabase.** Aplicar la nueva migración sólo en staging con fixtures
   sin datos reales.
3. **RPCs y pruebas de carrera.** Probar doble claim, lease viejo, doble finalize,
   colisiones y rollback.
4. **Publisher compensable.** Implementar staging/promoción/cleanup y fallos
   inyectados en cada frontera.
5. **Worker Modal staging.** Desplegar T4 con un input, cero warm containers y
   secrets/Volume de staging.
6. **Dispatcher staging.** Conectar outbox, slot, presupuesto y kill switch.
7. **Adaptar worker local.** Usar la misma RPC; demostrar exclusión cambiando
   `local -> paused -> modal -> paused -> local`.
8. **Canaries sintéticos.** Ejecutar al menos 20 requests controlados, uno a la
   vez, incluyendo redelivery y fallos recuperables.
9. **Drill de rollback y gasto.** Activar kill switch, recuperar job atascado,
   verificar cero GPU y volver a local.
10. **Revisión Go/No-Go.** Presentar métricas, costo, incidentes y evidencia. Sólo
    una aprobación explícita permite un canary de producción limitado.

## 15. Rollback completo al worker local

1. Invocar `engage_worker_kill_switch(reason)` para impedir inmediatamente
   nuevos claims y despachos sin robar el lease vigente.
2. Detener nuevos despachos y esperar o recuperar de forma controlada el único
   intento activo.
3. Confirmar cero leases activos; entonces invocar
   `set_worker_mode(expected_generation, 'paused', reason)` con la generación
   vigente.
4. Confirmar cero contenedores, cero GPUs, outbox sin leases y ninguna
   publicación parcial sin compensar.
5. Para cada request que estuvo `processing`, decidir usando DB + ownership: finalizar si
   ya está confirmado, o compensar y devolver a `queued` con auditoría.
6. Mantener schemas nuevos en modo inerte; no hacer DDL destructivo durante el
   incidente.
7. Limpiar el kill switch mediante su RPC restringida, con cero leases; luego
   invocar `set_worker_mode(expected_generation, 'local', reason)` y conservar
   la nueva `generation`.
8. Encender un solo worker local adaptado y comprobar que reclama mediante la
   RPC común.
9. Procesar primero un request canary y luego liberar la cola.
10. Revocar el token de despacho Modal si el rollback durará más que el incidente.
11. Documentar causa, costo, jobs afectados y decisión antes de reactivar Modal.

Rollback no requiere mover objetos a otro proveedor: ambos workers usan el
mismo Supabase Storage y contrato.

## 16. Checklist Go/No-Go de salida de staging

### Diseño e implementación en staging

- [ ] Dispatcher propietario y autenticación aprobados. Código aislado creado;
  falta desplegar y verificar en un proyecto staging real.
- [x] Ningún camino controlado permite invocar Modal sin UUID explícito.
  Evidencia: `DispatchReceipt.from_payload`, `canonical_uuid` y test
  `test_claim_passes_exact_receipt_to_common_rpc`.
- [ ] Web Function Modal exige Proxy Auth; requests sin token, con token de otro
  Environment o con generación obsoleta son rechazados. Proxy Auth y CAS están
  codificados; faltan las tres pruebas HTTP contra staging.
- [ ] Staging y producción tienen Environments, endpoints, Proxy Tokens,
  Secrets y Volumes separados; no existen cross-environment lookups. Bloqueado:
  aún no existe configuración cloud de staging inequívoca.
- [ ] Semántica ACK verificada: 202 inicial, 200 replay sin spawn, 409 stale y
  redelivery con el mismo `dispatch_id` ante timeout/5xx. Implementada, no
  verificada contra Modal/Supabase staging.
- [ ] Un ACK perdido después del spawn no duplica efectos ni incrementa el
  intento; el caso queda trazado y reconciliable. El estado `spawning` queda
  cerrado a un segundo spawn; falta el drill remoto.
- [ ] Claim RPC impide doble procesamiento y respeta `worker_control`. El
  oráculo local de 32 carreras tiene un ganador; falta PostgreSQL staging real.
- [ ] `set_worker_mode` usa `SECURITY DEFINER`, `search_path=pg_catalog`, objetos
  schema-qualified y ACL exclusiva de `worker_control_admin`. Verificación
  estática pasa; falta inspeccionar ACL después de aplicar la migración.
- [ ] `worker_control_owner` es NOLOGIN y el acceso DML directo a tablas de
  control está revocado para `PUBLIC`, `anon`, `authenticated` y `service_role`.
  SQL listo; falta consulta de catálogo en staging.
- [ ] `set_worker_mode` aplica CAS sobre `generation`, audita la transición,
  prohíbe `local <-> modal` directo y rechaza con cualquier lease activo. SQL
  listo; faltan pruebas transaccionales reales.
- [ ] Claim y cambio de modo bloquean la misma fila de control; una prueba de
  carrera demuestra que no aparece un lease durante la transición. Falta DB.
- [ ] `song_id` reservado y ownership único verificados bajo carrera. Índices y
  guards listos; falta DB.
- [x] `requests.status` conserva exactamente `queued | processing | done |
  error`; retry programado vuelve a `queued` con `next_attempt_at` y el
  frontend actual funciona sin cambios. Evidencia: migración no altera el check,
  65 tests web y build Next.js pasan.
- [x] Saga de publicación probada con fallo inyectado en cada paso. Evidencia:
  cuatro casos `after_stage_*`/`after_commit_*`, todos compensan y 12/12 tests.
- [ ] JWT autenticado no puede listar, leer, descargar, firmar ni borrar ningún
  objeto `_staging`; sí conserva acceso permitido a objetos canónicos. Policies
  listas; faltan pruebas JWT reales de las cinco operaciones.
- [ ] Source retenido y cleanup diferido probado. El código no borra uploads;
  falta evidencia remota del reconciliador.
- [ ] Lease, heartbeat, reconciliación y dos intentos máximos probados. RPCs
  listas; falta prueba con reloj/DB real.
- [ ] Logs no contienen secrets, signed URLs ni rutas privadas. Redactor pasa
  unit test; falta revisar logs de canaries.
- [ ] Métricas y alertas llegan con `request_id` correlacionable. Métricas y
  `trace_id` implementados; alertas no conectadas.
- [ ] Ledger, reservas, kill switch y hard stop de $20 probados. RPCs atómicas
  listas; falta drill en staging.
- [x] Modal mantiene `min_containers=0`, `max_containers=1`, `max_inputs=1` y
  `retries=0`. Evidencia: configuración estática cubierta por test.
- [ ] Secrets y checkpoint por Environment, versionados/rotables; hash falla
  cerrado y ninguna credencial de staging funciona en producción. Código falla
  cerrado; faltan recursos aislados y rotación.
- [ ] Worker local usa el claim común y no puede reclamar en modo Modal. Entrada
  opt-in lista; falta exclusión real contra staging.
- [ ] Rollback completo ensayado sin pérdida ni doble publicación. Script down y
  RPCs listos; no se aplicó nada remoto que pueda ensayarse.
- [x] Tests Python, tests web, build y nuevas pruebas de integración pasan.
  Evidencia: 49 ML + 15 controladas = 64 ML/worker, 65 web y build Next.js
  exitoso.
- [ ] 5–8 canaries dirigidos en staging cubren happy paths frío/caliente,
  replay, ACK ambiguo, publicación recuperable, kill switch y rollback, sin
  duplicados. Los oráculos sintéticos locales no cuentan como canaries T4.
- [ ] Costo exitoso observado <=$0.03 por canción representativa y sin tendencia
  creciente inexplicada. Costo de esta fase local: $0; falta medición T4 staging.

### Decisión

**Estado actual: hardening local aprobado por seguridad; NO-GO para desplegar o
ejecutar staging y NO-GO para producción.** Primero debe provisionarse únicamente
la identidad vacía del staging temporal, fijarse el `project_ref` real en la
allowlist/fingerprint mediante un cambio revisado y obtener una autorización
separada para la validación remota. Un canary de producción sólo puede evaluarse
después de completar la evidencia necesaria en staging, sin Sev-1/Sev-2 abiertos,
con rollback ensayado y otra autorización explícita.

**NO-GO** si existe cualquier bypass del claim, publicación no compensable,
secret en logs, concurrencia >1, gasto no acotado, job atascado no recuperable,
rollback no probado o discrepancia de contrato/calidad.

## 17. Riesgos residuales

| Riesgo | Mitigación | Riesgo residual |
|---|---|---|
| Entrega duplicada del webhook | Claim + outbox + finalización idempotente | Doble invocación barata antes del claim |
| Caída entre Storage y DB | Saga, ownership y reconciliación | Cleanup diferido/manual excepcional |
| Service-role comprometida | Secret aislado, sanitización, rotación | Alto impacto; requiere respuesta inmediata |
| Billing retrasado | Ledger y reservas conservadoras | Diferencia temporal con factura final |
| Modal indisponible | Retry único + rollback local | Mayor latencia durante incidente |
| Worker local encendido por error | Control DB dentro de claim | Requiere que todo camino use la RPC |
| Cold start | Imagen/checkpoint fijados; medir | Latencia inicial sin costo warm permanente |
| Evento de finalización perdido | Reconciliador CPU acotado | Hasta 5 minutos de demora |
| Usuario autenticado accede a staging | RLS excluye primer segmento `_staging`; pruebas de list/download/sign/delete | Service-role conserva acceso amplio |
| ACK perdido después de spawn | Receipt por `dispatch_id` + claim idempotente | Invocación duplicada sin efectos en ventana extrema |
| Token Proxy Auth cruzado entre entornos | Tokens distintos y asociados por Environment | Error de configuración detiene despacho |
| Cambio de modo en carrera | RPC CAS, row lock común y rechazo con leases | Requiere que no exista UPDATE directo |

## 18. Recomendación al MASTER

**GO de seguridad para cerrar el hardening local; NO-GO operativo para staging
y NO-GO para producción.** La revisión estática final encontró 0 Critical,
0 High y 0 Medium. El bootstrap de identidad temporal, el despliegue remoto y
los canaries requieren autorizaciones posteriores y separadas. Producción
continúa desautorizada hasta completar y revisar la evidencia necesaria de
staging.
