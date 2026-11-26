# Regenerates docs/flows PNG + SVG from Mermaid sources.
# Run after editing docs/flows/*.mmd (see docs/OPERATOR-FLOWS.md maintenance checklist).
param(
  [string]$Root = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = 'Stop'
$flows = Join-Path $Root 'docs\flows'
if (-not (Test-Path $flows)) { throw "Missing $flows" }

$chromeCandidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$chrome = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Chrome or Edge required to render Mermaid charts.' }

$cfg = Join-Path $env:TEMP "rover-mermaid-puppeteer-$PID.json"
$puppeteerJson = @{ executablePath = $chrome; args = @('--no-sandbox') } | ConvertTo-Json
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($cfg, $puppeteerJson, $utf8NoBom)

try {
  $charts = @(
    @{ In = 'one-time-setup.mmd'; OutPng = 'one-time-setup.png'; OutSvg = 'one-time-setup.svg' },
    @{ In = 'running-the-app.mmd'; OutPng = 'running-the-app.png'; OutSvg = 'running-the-app.svg' }
  )
  foreach ($c in $charts) {
    $in = Join-Path $flows $c.In
    if (-not (Test-Path $in)) { throw "Missing $in" }
    Write-Host "Rendering $($c.In) ..."
    npx --yes @mermaid-js/mermaid-cli@11.4.2 -i $in -o (Join-Path $flows $c.OutPng) -b white -s 2 -p $cfg
    npx --yes @mermaid-js/mermaid-cli@11.4.2 -i $in -o (Join-Path $flows $c.OutSvg) -b white -p $cfg
  }
  Write-Host "Done. Updated PNG/SVG under docs/flows/"
  Write-Host "If node labels changed, also edit docs/flows/operator-flows.html to match."
} finally {
  Remove-Item $cfg -Force -ErrorAction SilentlyContinue
}
