param(
  [switch]$EnableSoem,
  [string]$SoemRoot = "",
  [string]$NpcapRoot = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path -LiteralPath $vswhere)) {
  throw "Visual Studio Build Tools were not found."
}

$vsRoot = & $vswhere -latest -products * -property installationPath
if (-not $vsRoot) {
  throw "Visual Studio Build Tools installation path was not found."
}
$vsVersion = & $vswhere -latest -products * -property installationVersion
$vsMajor = if ($vsVersion) {
  ($vsVersion.Split(".")[0])
} else {
  ""
}

$cmake = Join-Path $vsRoot "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
if (-not (Test-Path -LiteralPath $cmake)) {
  $cmakeCommand = Get-Command cmake.exe -ErrorAction SilentlyContinue
  if (-not $cmakeCommand) {
    throw "CMake was not found."
  }
  $cmake = $cmakeCommand.Source
}

$generatorByMajor = @{
  "18" = "Visual Studio 18 2026"
  "17" = "Visual Studio 17 2022"
  "16" = "Visual Studio 16 2019"
}
$generator = $generatorByMajor[$vsMajor]
if (-not $generator) {
  $generatorHelp = & $cmake --help
  $generator = $generatorHelp |
    Select-String -Pattern "^\s+Visual Studio [0-9]+ [0-9]+" |
    Select-Object -Last 1 |
    ForEach-Object { $_.Line.Trim() }
  if (-not $generator) {
    throw "No supported Visual Studio CMake generator was found."
  }
}

$buildDir = Join-Path $root "native\build"
$sourceDir = Join-Path $root "native\soem-core"
$arguments = @(
  "-S", $sourceDir,
  "-B", $buildDir,
  "-G", $generator,
  "-A", "x64",
  "-DECAT_ENABLE_SOEM=$($EnableSoem.IsPresent.ToString().ToUpper())"
)

if ($SoemRoot) {
  $arguments += "-DECAT_SOEM_ROOT=$SoemRoot"
}
if ($NpcapRoot) {
  $arguments += "-DECAT_NPCAP_ROOT=$NpcapRoot"
}

& $cmake @arguments
if ($LASTEXITCODE -ne 0) {
  throw "Native core configure failed with exit code $LASTEXITCODE."
}

Write-Host "Native core configured at $buildDir"
