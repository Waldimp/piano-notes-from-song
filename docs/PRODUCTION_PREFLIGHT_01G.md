# 01G — Production preflight and backup evidence

Date: 2026-09-19.  This document records a read-only preflight.  It is not
authorization to open a maintenance window.

Final 01G status: **closed — GO técnico para una ventana de migración
explícitamente autorizada por el MASTER**. La conexión PostgreSQL se utilizó
sólo dentro del proceso local para inventario read-only y backup; ningún valor
se copió a documentación, Git, logs o artefactos de evidencia.

## Confirmed identity and access boundary

The only confirmed non-secret identifier is the Supabase project ref
`epapmenfnyfqdfmsgfee`.  It was derived from the existing local Supabase
origin after validating that it is a canonical HTTPS `*.supabase.co` origin.
No URL, token, JWT, key, password, signed URL, or connection string is stored
in this document.

The existing local generic service credential was used only for authenticated,
read-only Storage inventory/list/download requests. REST reads for `requests`
and `songs` returned HTTP 401. It is therefore not a usable database inventory
or backup credential. No alternate credentials were loaded, requested, or
tried.

`scripts/production-canary/identity-allowlist.json` remains intentionally
empty. This is fail-closed: no production-canary worker can validate until the
future deployment phase supplies and reviews the exact Modal dispatch endpoint
alongside a reviewed non-secret manifest. Do not populate it by inference.
`scripts/production-canary/identity-evidence.json` separately records only the
confirmed non-secret project ref and is not consumed by runtime code. The required
runtime namespace is exclusively `PRODUCTION_CANARY_*`, with
`PIANO_ENVIRONMENT=production-canary` and
`MODAL_ENVIRONMENT=production-canary`; generic and cross-environment variables
are rejected by `apps/worker/piano_worker/controlled.py`.

## Remote inventory obtained

| Area | Evidence | Result |
| --- | --- | --- |
| Supabase project | Canonical origin validation | project ref confirmed above |
| PostgreSQL catalog and data | `psql` in transaction read-only | PostgreSQL 17.6; catálogo y estados capturados |
| Storage buckets | authenticated GET bucket listing | private `uploads`, `audio`, `notes` |
| Storage objects | authenticated read-only listing and GET copies | 0 `uploads`, 3 `audio`, 3 `notes`; all local copies readable |
| Modal | not contacted | endpoint intentionally pending future deployment |

Only read-only inventory SQL was executed. No DDL, DML, mutating RPC,
migration, dispatcher invocation, polling, request claim, GPU action, Modal
action, or storage mutation was executed.

## SQL comparison status

The production catalog was read in a transaction declared read-only. Compatibility
was compared against the exact migration hashes below:

| File | SHA-256 |
| --- | --- |
| `0002_modal_worker_controlled_staging.sql` | `3b60618122c3933a2f95c5fa1ad4cbec1e0dda4887f8ff2013efdd14bed73cca` |
| `0002_modal_worker_controlled_staging.down.sql` | `ed03d3d1b407b7b75d31dca4c0778923f5b3f8ba6fb3afac77acfcf2f6a95ef5` |
| `0003_production_canary_single_uuid.sql` | `2ed497c5e5f9c28289f5a86132fdf4002fc49e9e71b4b6f0c0bb91a8b9414a2a` |
| `0003_production_canary_single_uuid.down.sql` | `9090500c997c723945764756ba6e35fc503522a08a7ead402ae6085a1e846918` |

- 0002 expects to extend `public.requests` and `public.songs`, create the
  `worker_*`, attempt, outbox, reconciliation, artifact and nonce objects,
  replace controlled functions/triggers, and establish role/grant/RLS state.
- 0003 expects 0002's control/outbox functions and adds
  `public.production_canary_arm`, two SECURITY DEFINER functions, RLS policies
  and role grants.
- The DOWN order is mandatory: 0003 before 0002.  Both must be compared
  against existing owners, `proconfig`/`search_path`, grants, policies,
  triggers, extensions, indexes and any custom functions before use.

Observed baseline and comparison result:

- PostgreSQL is 17.6; extensions include `pgcrypto`, so the UUID defaults used
  by 0002 are available.
- `requests` has the baseline 11 columns, baseline status check, primary key
  and `(status, created_at)` index; `songs` has the baseline 11 columns and
  primary key. The controlled columns, FK and indexes introduced by 0002 are
  absent, so no column/index collision was found.
- The only public function is non-SECURITY-DEFINER `set_updated_at()` owned by
  `postgres`; the only public trigger is `songs_set_updated_at`. No controlled
  function, SECURITY DEFINER owner, controlled trigger, role, enum, table or
  0003 arm object exists.
- All 24 expected names from 0002/0003 were checked and are absent as tables,
  functions or types. This is a clean create path.
- `requests` and `songs` already have RLS enabled. Existing policies and broad
  grants to `anon`/`authenticated`/`service_role`, plus the three baseline
  Storage policies, were captured. 0002 intentionally replaces these direct
  grants and the audio/notes policies; the snapshot is the restoration source.
- Request state is exactly `done=3`, `processing=0`. Since 0002 has not run,
  no controlled leases, attempts or outbox receipts can exist.

Residual migration risk: 0002 changes grants/policies and replaces/adds
triggers; its DOWN cannot reconstruct any undocumented customization. The
catalog snapshot and logical dump now preserve the observed baseline.

## Backup and Storage snapshot status

The protected destination is
`.local-backups/production-canary-preflight/` (gitignored and ACL-restricted
to the local user). PostgreSQL 17.11 client-only binaries (`pg_dump`,
`pg_restore`, `psql`) were extracted from the official EDB binary archive;
no server was installed or started. The archive SHA-256 is
`6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3`.
The verified logical backup is `postgresql-20260919-230818.dump`: 298,246
bytes, custom format, `--no-owner --no-acl`, SHA-256
`c5f6e392516b75bba8569ac80f99b6ce0a5afb177b354471f04f6a5e2da950ad`.
`pg_restore --list` succeeded using PostgreSQL client 17.11. Its complete
catalogue is retained locally as `postgresql-dump-toc-20260919-230818.txt` and
the redacted inventory is `postgresql-catalog-20260919-230818.txt`; both are
inside the ACL-restricted, gitignored backup directory.

Storage recovery copy completed in `storage-objects/`. The private local
`storage-manifest.json` records each original object name, redacted path digest,
size, timestamps, metadata, local copy and content SHA-256. It lists 0 objects
in `uploads`, 3 in `audio`, and 3 in `notes`; every copy was reopened byte-for-byte.
The six verified copies total 8,184,488 bytes. The manifest is 5,731 bytes and its SHA-256 is
`4952a0fc76587f41470f67ddf51f35d870206489b1a363c395b96e8cc87a78ad`.
No signed URL was generated or recorded.

When read-only database access and approved client tooling are supplied, the
required sequence is: custom-format `pg_dump --no-owner --no-acl` to that
directory; calculate SHA-256; check nonzero/reasonable size; run
`pg_restore --list` and retain that catalogue as evidence; capture redacted
catalog/grant/RLS/function snapshots;
list only recovery-relevant objects in the three private buckets; copy them
without deletion; hash each copy where possible; write a manifest with a
SHA-256; and prove every local copy is readable. The MASTER accepts this
integrity validation without an isolated restore rehearsal; absence of a full
restore test remains a residual risk. Do not perform database steps without an
approved local database connection.

`scripts/production-canary/run_postgres_preflight.ps1` completed successfully
with a session-pooler connection bound to the confirmed project. It records a
redacted catalogue, custom dump, dump SHA-256 and `pg_restore --list` catalogue
only under the protected backup directory. It did not apply SQL, call RPCs or
restore.

## Prepared rollback procedure (not executed)

1. Activate the kill switch and keep the dispatcher disabled.
2. Stop the authorized dispatcher and local polling; retain the legacy local
   worker ready but inactive as the fallback.
3. Query until there are zero request leases, active attempts, and ambiguous
   `spawning`/`acknowledged` receipts; abort destructive rollback guards rather
   than bypassing them.
4. Execute `0003_production_canary_single_uuid.down.sql` first.  Only after
   its guards pass, execute `0002_modal_worker_controlled_staging.down.sql`.
5. Restore role memberships, grants, RLS policies, function owners/config and
   Storage policies from the approved pre-change snapshots; validate the
   legacy local worker uses no canary path before reactivation.
6. Use the logical backup only if DOWN cannot complete cleanly, a migration
   damaged pre-existing data/catalog state, or snapshot reconciliation detects
   unrecoverable divergence. A restore, if needed, requires a separately
   authorized recovery procedure; it was not rehearsed during this preflight.

## Current recommendation

**GO técnico de preflight (01G cerrado).** Backup PostgreSQL y Storage,
inventario SQL, hashes, catálogo del dump y comparación contra 0002/0003 están
completos. El MASTER conserva la autorización exclusiva para abrir la ventana
o aplicar una migración. El endpoint Modal permanece pendiente y fail-closed,
por lo que no autoriza ningún deploy. Un restore completo no fue ensayado y
sigue siendo el riesgo residual explícito.
