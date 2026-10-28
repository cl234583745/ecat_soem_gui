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

if ($normalizedLicense -ne "gpl") {
  throw @"
This project is distributed under GPL-3.0-only and links SOEM under its GPLv3 option.
Set ECAT_SOEM_LICENSE_MODE to "gpl" before building a distributable SOEM package.
Any other distribution requires a separate legal review and a compatible license.
"@
}

$requiredFiles = @(
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "README.md",
  "CHANGELOG.md",
  "licenses\Electron-Chromium-LICENSES.html",
  "licenses\Electron-LICENSE.txt",
  "licenses\Lucide-LICENSE.txt",
  "licenses\nlohmann-json-LICENSE.txt",
  "licenses\React-LICENSE.txt",
  "licenses\ReactDOM-LICENSE.txt",
  "licenses\SOEM-LICENSE.md"
)
foreach ($relativePath in $requiredFiles) {
  $fullPath = Join-Path $root $relativePath
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw "Required license or notice file is missing: $relativePath"
  }
}

$packageJson = Get-Content -LiteralPath (Join-Path $root "package.json") -Raw |
  ConvertFrom-Json
if ($packageJson.license -ne "GPL-3.0-only") {
  throw "package.json must declare GPL-3.0-only for a SOEM GPL distribution."
}
$projectLicense = Get-Content -LiteralPath (Join-Path $root "LICENSE") -Raw
if ($projectLicense -notmatch "GNU GENERAL PUBLIC LICENSE") {
  throw "LICENSE does not contain the GNU General Public License text."
}

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
  throw "npm.cmd was not found on PATH."
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
  & $npm.Source run assets:icons
  if ($LASTEXITCODE -ne 0) { throw "Icon generation failed." }

  & $npm.Source run build
  if ($LASTEXITCODE -ne 0) { throw "Renderer build failed." }

  & $npm.Source run native:build -- -EnableSoem -SoemRoot $SoemRoot -NpcapRoot $NpcapRoot
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

  $unpackedRoot = Join-Path $root "release\win-unpacked"
  foreach ($relativePath in $requiredFiles) {
    $packagedPath = Join-Path $unpackedRoot $relativePath
    if (-not (Test-Path -LiteralPath $packagedPath -PathType Leaf)) {
      throw "Packaged application is missing required file: $relativePath"
    }
  }

  $soemCommit = "unknown"
  $upstreamFile = Join-Path $soemPath "UPSTREAM.md"
  if (Test-Path -LiteralPath $upstreamFile -PathType Leaf) {
    $upstreamText = Get-Content -LiteralPath $upstreamFile -Raw
    if ($upstreamText -match "Commit:\s*([0-9a-fA-F]{40})") {
      $soemCommit = $Matches[1].ToLowerInvariant()
    }
  } elseif (Test-Path -LiteralPath (Join-Path $soemPath ".git")) {
    $gitCommit = (& git -C $soemPath rev-parse HEAD 2>$null)
    if ($LASTEXITCODE -eq 0 -and $gitCommit) {
      $soemCommit = $gitCommit.Trim()
    }
  }
  $manifest = [ordered]@{
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    projectVersion = $packageJson.version
    projectLicense = $packageJson.license
    coreMode = "soem"
    licenseMode = $normalizedLicense
    soemRoot = $SoemRoot
    soemCommit = $soemCommit
    npcapSdk = $NpcapRoot
  }
  $manifestPath = Join-Path $root "artifacts\soem-package-manifest.json"
  New-Item -ItemType Directory -Force -Path (Split-Path $manifestPath) | Out-Null
  $manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  Write-Host "SOEM package manifest: $manifestPath"
} finally {
  Pop-Location
}
