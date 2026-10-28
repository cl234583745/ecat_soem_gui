param(
  [switch]$EnableSoem,
  [string]$SoemRoot = "",
  [string]$NpcapRoot = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vsRoot = if (Test-Path -LiteralPath $vswhere) {
  & $vswhere -latest -products * -property installationPath
} else {
  ""
}

$cmake = ""
$generator = ""
$toolchainArguments = @()

if ($vsRoot) {
  $vsVersion = & $vswhere -latest -products * -property installationVersion
  $vsMajor = if ($vsVersion) {
    ($vsVersion.Split(".")[0])
  } else {
    ""
  }

  $vsCmake = Join-Path $vsRoot "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
  if (Test-Path -LiteralPath $vsCmake) {
    $cmake = $vsCmake
  }

  $generatorByMajor = @{
    "18" = "Visual Studio 18 2026"
    "17" = "Visual Studio 17 2022"
    "16" = "Visual Studio 16 2019"
  }
  $generator = $generatorByMajor[$vsMajor]
  $toolchainArguments = @("-A", "x64")
} else {
  $gcc = Get-Command gcc.exe -ErrorAction SilentlyContinue
  $gxx = Get-Command g++.exe -ErrorAction SilentlyContinue
  if (-not $gcc -or -not $gxx) {
    throw "No supported C++ toolchain was found. Install Visual Studio Build Tools or MinGW-w64."
  }

  $toolchainArguments = @(
    "-DCMAKE_BUILD_TYPE=Release",
    "-DCMAKE_C_COMPILER=$($gcc.Source)",
    "-DCMAKE_CXX_COMPILER=$($gxx.Source)"
  )
  if (Get-Command ninja.exe -ErrorAction SilentlyContinue) {
    $generator = "Ninja"
  } elseif (Get-Command mingw32-make.exe -ErrorAction SilentlyContinue) {
    $generator = "MinGW Makefiles"
  } else {
    throw "MinGW was found, but neither Ninja nor mingw32-make is available."
  }
}

if (-not $cmake) {
  $cmakeCommand = Get-Command cmake.exe -ErrorAction SilentlyContinue
  if (-not $cmakeCommand) {
    throw "CMake was not found."
  }
  $cmake = $cmakeCommand.Source
}

if (-not $generator) {
  $generatorHelp = & $cmake --help
  $generator = $generatorHelp |
    Select-String -Pattern "^\s+Visual Studio [0-9]+ [0-9]+" |
    Select-Object -Last 1 |
    ForEach-Object { $_.Line.Trim() }
  if (-not $generator) {
    throw "No supported Visual Studio CMake generator was found."
  }
  $toolchainArguments = @("-A", "x64")
}

$buildDir = Join-Path $root "native\build"
$sourceDir = Join-Path $root "native\soem-core"
$arguments = @(
  "-S", $sourceDir,
  "-B", $buildDir,
  "-G", $generator,
  "-DECAT_ENABLE_SOEM=$($EnableSoem.IsPresent.ToString().ToUpper())"
) + $toolchainArguments

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
