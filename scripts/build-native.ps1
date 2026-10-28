param(
  [switch]$EnableSoem,
  [string]$SoemRoot = "",
  [string]$NpcapRoot = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

& (Join-Path $PSScriptRoot "configure-native.ps1") `
  -EnableSoem:$EnableSoem.IsPresent `
  -SoemRoot $SoemRoot `
  -NpcapRoot $NpcapRoot

$cmakeCommand = Get-Command cmake.exe -ErrorAction SilentlyContinue
if ($cmakeCommand) {
  $cmake = $cmakeCommand.Source
} else {
  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  $vsRoot = & $vswhere -latest -products * -property installationPath
  $cmake = Join-Path $vsRoot "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
}
$buildDir = Join-Path $root "native\build"

& $cmake --build $buildDir --config Release --parallel
if ($LASTEXITCODE -ne 0) {
  throw "Native core build failed with exit code $LASTEXITCODE."
}

$binary = Join-Path $buildDir "bin\ecat-core.exe"
if (-not (Test-Path -LiteralPath $binary)) {
  throw "Native core binary was not produced at $binary."
}

Write-Host "Native core built: $binary"
