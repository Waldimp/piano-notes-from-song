# Interactive (run in YOUR terminal, not chat):
#   powershell -ExecutionPolicy Bypass -File scripts/production-canary/set_wompi_vercel_secrets.ps1
#
# Only App ID + API Secret. idAplicativo defaults to App ID in app code (Wompi docs).
$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot "..\.."))
$statusFile = Join-Path $env:TEMP "wompi-vercel-env-status.txt"
Set-Content -Path $statusFile -Value "started" -Encoding ascii

function Set-SecretEnv([string]$name, [string]$label) {
  Write-Host "`n=== $label ===" -ForegroundColor Cyan
  Write-Host "Paste value (hidden) then Enter:"
  $sec = Read-Host -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    if ([string]::IsNullOrWhiteSpace($plain)) { throw "empty $name" }
    $plain | npx --yes vercel env add $name production --yes --force | Out-Null
    Write-Host "$name OK" -ForegroundColor Green
  } finally {
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    $plain = $null
    if ($sec) { $sec.Dispose() }
  }
}

try {
  Set-SecretEnv "WOMPI_CLIENT_ID" "1/2 App ID → WOMPI_CLIENT_ID"
  Set-SecretEnv "WOMPI_CLIENT_SECRET" "2/2 API Secret → WOMPI_CLIENT_SECRET"
  Set-Content -Path $statusFile -Value "ok" -Encoding ascii
  Write-Host "`nDone. Reply in chat: secrets set" -ForegroundColor Green
} catch {
  Set-Content -Path $statusFile -Value ("error:" + $_.Exception.Message) -Encoding ascii
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}
