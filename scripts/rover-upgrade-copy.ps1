<#
.SYNOPSIS
  Copy local Rover operator data from an old folder into a new version folder.

.DESCRIPTION
  Implements docs/ROVER-UPDATE-COPY.md. Copies research/ (all niche photo masters
  and groups), .env, census geo database, photo-prompt-app, public/images, and
  optional cache/sounds/backups. Does not copy node_modules, dist, or .astro.

.PARAMETER OldRoot
  Absolute path to the previous Rover folder (source).

.PARAMETER NewRoot
  Absolute path to the new Rover folder (destination). Defaults to the repo that
  contains this script (parent of scripts/).

.PARAMETER SkipOptional
  Skip .cache, ops/sounds, and site-config backups.

.EXAMPLE
  .\scripts\rover-upgrade-copy.ps1 -OldRoot "C:\RanknRent\Rover-2.7-upstream" -NewRoot "C:\RanknRent\Rover-2.8-upstream"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$OldRoot,

  [Parameter(Mandatory = $false)]
  [string]$NewRoot = "",

  [switch]$SkipOptional
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-FullPath([string]$Path) {
  return [System.IO.Path]::GetFullPath($Path)
}

function Ensure-Parent([string]$Path) {
  $parent = Split-Path -Parent $Path
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
}

function Copy-Tree([string]$Source, [string]$Dest, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Source)) {
    Write-Host "SKIP  $Label (missing in old folder): $Source"
    return $false
  }
  Ensure-Parent $Dest
  Write-Host "COPY  $Label"
  Write-Host "      $Source"
  Write-Host "   -> $Dest"
  # /E subdirs including empty; /XD skip junk; /NFL /NDL quieter; /NJH /NJS less noise
  $args = @(
    $Source, $Dest, '/E', '/IS', '/IT',
    '/XD', 'node_modules', 'dist', '.astro',
    '/NFL', '/NDL', '/NJH', '/NJS', '/NP'
  )
  & robocopy @args | Out-Null
  $code = $LASTEXITCODE
  # robocopy: 0-7 success-ish; >=8 failure
  if ($code -ge 8) {
    throw "robocopy failed for $Label (exit $code)"
  }
  return $true
}

function Copy-File([string]$Source, [string]$Dest, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Source)) {
    Write-Host "SKIP  $Label (missing): $Source"
    return $false
  }
  Ensure-Parent $Dest
  Write-Host "COPY  $Label -> $Dest"
  Copy-Item -LiteralPath $Source -Destination $Dest -Force
  return $true
}

if (-not $NewRoot) {
  $NewRoot = Resolve-FullPath (Join-Path $PSScriptRoot '..')
}

$OldRoot = Resolve-FullPath $OldRoot
$NewRoot = Resolve-FullPath $NewRoot

if (-not (Test-Path -LiteralPath $OldRoot)) {
  throw "OldRoot not found: $OldRoot"
}
if (-not (Test-Path -LiteralPath $NewRoot)) {
  throw "NewRoot not found: $NewRoot"
}
if ($OldRoot -eq $NewRoot) {
  throw "OldRoot and NewRoot are the same path."
}

Write-Host ""
Write-Host "Rover upgrade copy"
Write-Host "  Old: $OldRoot"
Write-Host "  New: $NewRoot"
Write-Host ""

$copied = @()

# Required trees
if (Copy-Tree (Join-Path $OldRoot 'research') (Join-Path $NewRoot 'research') 'research/ (candidates + ALL niche photo masters/groups)') {
  $copied += 'research/'
}
if (Copy-File (Join-Path $OldRoot '.env') (Join-Path $NewRoot '.env') '.env') {
  $copied += '.env'
}
if (Copy-File (Join-Path $OldRoot '.env.production') (Join-Path $NewRoot '.env.production') '.env.production') {
  $copied += '.env.production'
}
if (Copy-Tree (Join-Path $OldRoot 'data\census\boundaries') (Join-Path $NewRoot 'data\census\boundaries') 'data/census/boundaries/ (geo database)') {
  $copied += 'data/census/boundaries/'
}
if (Copy-Tree (Join-Path $OldRoot 'data\census\map') (Join-Path $NewRoot 'data\census\map') 'data/census/map/ (built map)') {
  $copied += 'data/census/map/'
}
if (Copy-Tree (Join-Path $OldRoot 'photo-prompt-app') (Join-Path $NewRoot 'photo-prompt-app') 'photo-prompt-app/') {
  $copied += 'photo-prompt-app/'
}
if (Copy-Tree (Join-Path $OldRoot 'public\images') (Join-Path $NewRoot 'public\images') 'public/images/') {
  $copied += 'public/images/'
}

# Optional
if (-not $SkipOptional) {
  if (Copy-Tree (Join-Path $OldRoot '.cache') (Join-Path $NewRoot '.cache') '.cache/') {
    $copied += '.cache/'
  }
  if (Copy-Tree (Join-Path $OldRoot 'ops\sounds') (Join-Path $NewRoot 'ops\sounds') 'ops/sounds/') {
    $copied += 'ops/sounds/'
  }
  $backupGlob = Join-Path $OldRoot 'src\config\site-config.backup-*.json'
  $backups = @(Get-Item -Path $backupGlob -ErrorAction SilentlyContinue)
  if ($backups.Count -gt 0) {
    $destConfig = Join-Path $NewRoot 'src\config'
    if (-not (Test-Path -LiteralPath $destConfig)) {
      New-Item -ItemType Directory -Path $destConfig -Force | Out-Null
    }
    foreach ($b in $backups) {
      Copy-Item -LiteralPath $b.FullName -Destination (Join-Path $destConfig $b.Name) -Force
    }
    Write-Host "COPY  $($backups.Count) site-config backup(s)"
    $copied += 'site-config backups'
  }
}

# Report photo masters
$pg = Join-Path $NewRoot 'research\_photo-groups'
Write-Host ""
if (Test-Path -LiteralPath $pg) {
  $masters = @(Get-ChildItem -LiteralPath $pg -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'master-*' })
  $groups = @(Get-ChildItem -LiteralPath $pg -Directory -ErrorAction SilentlyContinue)
  Write-Host "Photo library: $($groups.Count) group folder(s), $($masters.Count) niche master(s)"
  foreach ($m in $masters) {
    Write-Host "  master: $($m.Name)"
  }
} else {
  Write-Host "WARN  research/_photo-groups missing after copy — niche masters will not appear in Load photo group."
}

$forms = Join-Path $NewRoot 'research\forms-inbox.json'
if (-not (Test-Path -LiteralPath $forms)) {
  Write-Host "WARN  research/forms-inbox.json missing — after npm run rover, open Phone/Form → Set up inbox."
}

Write-Host ""
Write-Host "Copied: $($copied -join ', ')"
Write-Host ""
Write-Host "Next (in the NEW folder):"
Write-Host "  npm install"
Write-Host "  npm run build-research-map   # if map/ was skipped or you want a refresh"
Write-Host "  npm run rover"
Write-Host "  Verify: Forms inbox, Lead notify email, Load photo group (niche masters), Map/Service area"
Write-Host "Checklist: docs/ROVER-UPDATE-COPY.md"
Write-Host ""
