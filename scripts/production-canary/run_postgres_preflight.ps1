[CmdletBinding()]
param(
    [Parameter()]
    [ValidatePattern('^[A-Za-z0-9_.-]+$')]
    [string]$ServiceName = 'production-preflight'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$backup = Join-Path $root '.local-backups\production-canary-preflight'
$bin = Join-Path $backup 'postgres-client\bin'
$pgDump = Join-Path $bin 'pg_dump.exe'
$pgRestore = Join-Path $bin 'pg_restore.exe'
$psql = Join-Path $bin 'psql.exe'

foreach ($tool in @($pgDump, $pgRestore, $psql)) {
    if (-not (Test-Path -LiteralPath $tool)) {
        throw "Required PostgreSQL client tool is missing from the protected preflight directory."
    }
}
$localEnv = Join-Path $root '.env.local'
if (Test-Path -LiteralPath $localEnv) {
    foreach ($line in Get-Content -LiteralPath $localEnv) {
        if ($line -match '^PRODUCTION_PREFLIGHT_DATABASE_URL=(.+)$') {
            $env:PRODUCTION_PREFLIGHT_DATABASE_URL = $matches[1]
        }
    }
}

$connectionArgs = @()
$previousPgPassword = $env:PGPASSWORD
$previousSslMode = $env:PGSSLMODE
$usesTemporaryPassword = $false
if ($env:PRODUCTION_PREFLIGHT_DATABASE_URL) {
    try {
        $uri = [Uri]$env:PRODUCTION_PREFLIGHT_DATABASE_URL
        if ($uri.Scheme -notin @('postgres','postgresql') -or -not $uri.Host -or -not $uri.UserInfo -or -not $uri.AbsolutePath.Trim('/')) {
            throw 'connection URL is incomplete'
        }
        $parts = $uri.UserInfo.Split(':', 2)
        if ($parts.Count -ne 2) { throw 'connection URL requires user and password' }
        $user = [Uri]::UnescapeDataString($parts[0])
        $env:PGPASSWORD = [Uri]::UnescapeDataString($parts[1])
        $env:PGSSLMODE = if ($uri.Query -match '(?:^|[?&])sslmode=([^&]+)') { [Uri]::UnescapeDataString($matches[1]) } else { 'require' }
        $port = if ($uri.IsDefaultPort) { 5432 } else { $uri.Port }
        $database = [Uri]::UnescapeDataString($uri.AbsolutePath.Trim('/'))
        $connectionArgs = @("--host=$($uri.Host)", "--port=$port", "--username=$user", "--dbname=$database")
        $usesTemporaryPassword = $true
    } catch {
        throw 'Refused: PRODUCTION_PREFLIGHT_DATABASE_URL must be a complete PostgreSQL connection URL.'
    }
} else {
    if (-not $env:PGSERVICEFILE -or -not (Test-Path -LiteralPath $env:PGSERVICEFILE)) {
        throw "Refused: add PRODUCTION_PREFLIGHT_DATABASE_URL to .env.local, or set PGSERVICEFILE to a local pg_service.conf."
    }
    if (-not $env:PGPASSFILE -or -not (Test-Path -LiteralPath $env:PGPASSFILE)) {
        throw "Refused: set PGPASSFILE to a local pgpass.conf before running this read-only preflight."
    }
    $connectionArgs = @("--dbname=service=$ServiceName")
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dump = Join-Path $backup "postgresql-$stamp.dump"
$catalog = Join-Path $backup "postgresql-catalog-$stamp.txt"
$toc = Join-Path $backup "postgresql-dump-toc-$stamp.txt"
$summary = Join-Path $backup "postgresql-backup-$stamp.json"

$query = @'
BEGIN TRANSACTION READ ONLY;
SELECT 'server_version' AS section, version() AS detail;
SELECT 'schema' AS section, current_schema() AS detail;
SELECT 'extensions' AS section, extname || ':' || extversion AS detail
FROM pg_extension ORDER BY extname;
SELECT 'columns' AS section, table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default,'') AS detail
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('requests','songs')
ORDER BY table_name, ordinal_position;
SELECT 'constraints' AS section, c.conrelid::regclass::text || ':' || c.conname || ':' || pg_get_constraintdef(c.oid) AS detail
FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
WHERE n.nspname='public' AND c.conrelid::regclass::text IN ('requests','songs')
ORDER BY 2;
SELECT 'indexes' AS section, schemaname || '.' || tablename || ':' || indexname || ':' || indexdef AS detail
FROM pg_indexes WHERE schemaname='public' AND tablename IN ('requests','songs') ORDER BY 2;
SELECT 'functions' AS section, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):owner=' || r.rolname || ':security_definer=' || p.prosecdef || ':config=' || coalesce(array_to_string(p.proconfig,','),'') AS detail
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
WHERE n.nspname='public' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);
SELECT 'roles' AS section, rolname || ':login=' || rolcanlogin || ':super=' || rolsuper || ':inherit=' || rolinherit AS detail
FROM pg_roles WHERE rolname IN ('worker_control_owner','worker_control_admin','anon','authenticated','service_role') ORDER BY rolname;
SELECT 'table_grants' AS section, table_name || ':' || grantee || ':' || privilege_type AS detail
FROM information_schema.role_table_grants WHERE table_schema='public' ORDER BY table_name, grantee, privilege_type;
SELECT 'routine_grants' AS section, routine_name || ':' || grantee || ':' || privilege_type AS detail
FROM information_schema.role_routine_grants WHERE routine_schema='public' ORDER BY routine_name, grantee, privilege_type;
SELECT 'rls' AS section, c.relname || ':enabled=' || c.relrowsecurity || ':forced=' || c.relforcerowsecurity AS detail
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname;
SELECT 'policies' AS section, schemaname || '.' || tablename || ':' || policyname || ':' || cmd || ':roles=' || array_to_string(roles,',') || ':using=' || coalesce(qual,'') || ':check=' || coalesce(with_check,'') AS detail
FROM pg_policies WHERE schemaname IN ('public','storage') ORDER BY schemaname, tablename, policyname;
SELECT 'triggers' AS section, event_object_schema || '.' || event_object_table || ':' || trigger_name || ':' || action_timing || ':' || event_manipulation || ':' || action_statement AS detail
FROM information_schema.triggers WHERE event_object_schema='public' ORDER BY event_object_table, trigger_name;
SELECT 'request_states' AS section, status || ':' || count(*)::text AS detail FROM public.requests GROUP BY status ORDER BY status;
SELECT 'request_active' AS section, 'processing=' || count(*)::text AS detail FROM public.requests WHERE status='processing';
SELECT 'expected_name_collisions' AS section, x.name || ':table=' || exists(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=x.name)::text || ':function=' || exists(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=x.name)::text || ':type=' || exists(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname=x.name)::text AS detail
FROM (VALUES ('worker_mode'),('worker_control'),('worker_control_events'),('request_attempts'),('request_artifacts'),('dispatch_outbox'),('dispatch_reconciliations'),('dispatch_auth_nonces'),('worker_cost_ledger'),('production_canary_arm'),('consume_dispatch_auth_nonce'),('reserve_worker_cost'),('settle_worker_cost'),('release_worker_cost'),('prepare_controlled_request'),('enqueue_controlled_request'),('guard_controlled_mutation'),('claim_request'),('heartbeat_request'),('finalize_request'),('reserve_dispatch_spawn'),('reserve_production_canary_spawn'),('arm_production_canary_uuid')) AS x(name)
ORDER BY x.name;
COMMIT;
'@

try {
    Write-Host 'Running PostgreSQL catalog inventory in a read-only transaction.'
    $query | & $psql --no-psqlrc --set=ON_ERROR_STOP=1 @connectionArgs --tuples-only --no-align 2>&1 | Set-Content -LiteralPath $catalog -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw 'Catalog inventory failed; no dump was created.' }

    Write-Host 'Creating a custom logical dump with no owner or ACL restoration metadata.'
    & $pgDump --format=custom --no-owner --no-acl --file=$dump @connectionArgs 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed.' }
    if (-not (Test-Path -LiteralPath $dump) -or (Get-Item -LiteralPath $dump).Length -le 0) { throw 'pg_dump did not create a nonempty archive.' }

    & $pgRestore --list $dump 2>&1 | Set-Content -LiteralPath $toc -Encoding utf8
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $toc) -or (Get-Item -LiteralPath $toc).Length -le 0) { throw 'pg_restore --list failed.' }

    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $dump).Hash.ToLower()
    $result = [ordered]@{
    created_at_utc = (Get-Date).ToUniversalTime().ToString('o')
    dump_file = Split-Path $dump -Leaf
    dump_size_bytes = (Get-Item -LiteralPath $dump).Length
    dump_sha256 = $hash
    catalog_file = Split-Path $catalog -Leaf
    dump_toc_file = Split-Path $toc -Leaf
    validation = 'pg_restore --list succeeded'
    service_name = $ServiceName
    }
    $result | ConvertTo-Json | Set-Content -LiteralPath $summary -Encoding utf8
    Write-Host "Preflight backup completed: $($result.dump_file), SHA-256=$hash"
} finally {
    if ($usesTemporaryPassword) {
        if ($null -eq $previousPgPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue } else { $env:PGPASSWORD = $previousPgPassword }
        if ($null -eq $previousSslMode) { Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue } else { $env:PGSSLMODE = $previousSslMode }
        Remove-Item Env:PRODUCTION_PREFLIGHT_DATABASE_URL -ErrorAction SilentlyContinue
    }
}
