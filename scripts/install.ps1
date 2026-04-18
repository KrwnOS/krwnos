<#
.SYNOPSIS
  KrwnOS — one-command installer for Windows (Pro tier).

.USAGE
  iwr -useb https://get.krwnos.com/install.ps1 | iex
#>

[CmdletBinding()]
param(
  [string] $Repo    = ($env:KRWN_REPO  ?? "https://github.com/KrwnOS/krwnos.git"),
  [string] $Dir     = ($env:KRWN_DIR   ?? (Join-Path $HOME ".krwnos")),
  [string] $Ref     = ($env:KRWN_REF   ?? "main"),
  [int]    $Port    = [int]($env:KRWN_PORT ?? 3000),
  [string] $Tunnel  = ($env:KRWN_TUNNEL ?? "")
)

$ErrorActionPreference = "Stop"

function Bold($m) { Write-Host $m -ForegroundColor White -BackgroundColor DarkMagenta }
function Info($m) { Write-Host "  ▸ $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "  ✗ $m" -ForegroundColor Red; exit 1 }

Bold "KrwnOS installer — Pro tier"

foreach ($bin in @("docker","git")) {
  if (-not (Get-Command $bin -ErrorAction SilentlyContinue)) {
    Fail "Missing required binary: $bin"
  }
}

try { docker compose version *> $null } catch { Fail "docker compose v2 is required" }

if (Test-Path (Join-Path $Dir ".git")) {
  Info "Updating existing checkout at $Dir"
  git -C $Dir fetch --depth=1 origin $Ref
  git -C $Dir reset --hard "origin/$Ref"
} else {
  Info "Cloning KrwnOS → $Dir"
  git clone --depth=1 --branch $Ref $Repo $Dir
}

$DeployDir = Join-Path $Dir "deploy"
Set-Location $DeployDir

$envFile = Join-Path $DeployDir ".env"
if (-not (Test-Path $envFile)) {
  Info "Generating deploy/.env"
  $secret = [System.BitConverter]::ToString(
    (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes(32)
  ).Replace("-", "").ToLowerInvariant()
  @"
AUTH_SECRET=$secret
AUTH_URL=http://localhost:$Port
APP_URL=http://localhost:$Port
POSTGRES_USER=krwn
POSTGRES_PASSWORD=krwn
POSTGRES_DB=krwnos
KRWN_PORT=$Port
KRWN_TIER=pro
KRWN_VERSION=0.1.0
CLOUDFLARE_TUNNEL_TOKEN=$Tunnel
"@ | Set-Content -Encoding ASCII $envFile
}

Info "Building containers"
docker compose build --pull | Out-Host

Info "Applying schema (db push — no migrations yet in v0.1)"
docker compose run --rm app npx prisma db push --skip-generate | Out-Host

Info "Starting services"
if ($Tunnel) {
  docker compose --profile tunnel up -d | Out-Host
} else {
  docker compose up -d | Out-Host
}

Info "Bootstrapping Sovereign (interactive)"
try { docker compose exec app npm run setup | Out-Host } catch { }

Bold "✓ KrwnOS is live"
Write-Host ""
Write-Host "   local:    http://localhost:$Port"
if ($Tunnel) { Write-Host "   tunnel:   active (cloudflared)" }
Write-Host ""
Write-Host "   Next steps:"
Write-Host "     1. Save the CLI token printed by the setup wizard above."
Write-Host "     2. Run: krwn login --host http://localhost:$Port --token <raw>"
Write-Host "     3. Install your first module: krwn module install core.chat"
