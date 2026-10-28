param(
  [string]$SoemRoot = "third_party/SOEM",
  [string]$NpcapRoot = ".cache/npcap-sdk",
  [string]$LicenseMode = $env:ECAT_SOEM_LICENSE_MODE,
  [switch]$DirectoryOnly
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$normalizedLicense = if ($LicenseMode) {
  $LicenseMode.Trim().ToLowerInvariant()
} else {
  ""
}

if ($normalizedLicense -notin @("gpl", "commercial")) {
  throw @"
SOEM packaging requires an explicit license decision.
Set ECAT_SOEM_LICENSE_MODE to "gpl" or "commercial".
GPL mode requires the complete corresponding source and compatible project licensing.
Commercial mode requires a SOEM commercial license from RT-Labs.
"@
}

$soemPath = Join-Path $root $SoemRoot
$npcapPath = Join-Path $root $NpcapRoot
if (-not (Test-Path -LiteralPath (Join-Path $soemPath "CMakeLists.txt"))) {
  throw "SOEM source tree was not found at $soemPath."
}
if (-not (Test-Path -LiteralPath (Join-Path $npcapPath "Lib\x64\wpcap.lib"))) {
  throw "Npcap SDK was not found at $npcapPath."
}

Push-Location $root
try {
  & npm run assets:icons
  if ($LASTEXITCODE -ne 0) { throw "Icon generation failed." }

  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "Renderer build failed." }

  & npm run native:build -- -EnableSoem -SoemRoot $SoemRoot -NpcapRoot $NpcapRoot
  if ($LASTEXITCODE -ne 0) { throw "SOEM native build failed." }

  $builder = Join-Path $root "node_modules\.bin\electron-builder.cmd"
  & $builder --dir
  if ($LASTEXITCODE -ne 0) { throw "Unpacked application build failed." }

  & node scripts\patch-win-exe.mjs
  if ($LASTEXITCODE -ne 0) { throw "Executable metadata patch failed." }

  if (-not $DirectoryOnly) {
    & $builder --prepackaged release\win-unpacked --win nsis portable
    if ($LASTEXITCODE -ne 0) { throw "Windows installer build failed." }
  }

  $soemCommit = (& git -C $soemPath rev-parse HEAD 2>$null)
  $manifest = [ordered]@{
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    coreMode = "soem"
    licenseMode = $normalizedLicense
    soemRoot = $SoemRoot
    soemCommit = if ($soemCommit) { $soemCommit.Trim() } else { "unknown" }
    npcapSdk = $NpcapRoot
  }
  $manifestPath = Join-Path $root "artifacts\soem-package-manifest.json"
  New-Item -ItemType Directory -Force -Path (Split-Path $manifestPath) | Out-Null
  $manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  Write-Host "SOEM package manifest: $manifestPath"
} finally {
  Pop-Location
}
