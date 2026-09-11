<#
.SYNOPSIS
  PI-Desktop Windows build: NSIS installer + portable exe, plus a one-shot
  environment repair mode.

.DESCRIPTION
  One file, two modes:

    (default)  build and publish. Five build stages, equivalent to
               apps/desktop `dist:win`, then both installers are copied into
               the project root so the newest version is easy to find:
                 1. TypeScript workspace packages (tsc)
                 2. Rust host core (cargo, release)
                 3. agent-runtime sidecar bundle (esbuild)
                 4. Electron app (electron-vite)
                 5. electron-builder -> NSIS installer + portable exe
               It does no environment detection or repair: the preflight only
               fails fast with a pointer to `-Setup`.

    -Setup     check and repair the build environment, then exit. Persists what
               the Rust stage needs:
                 - user PATH    : cargo bin dir, newest MSVC x64 bin dir
                 - user LIB     : newest MSVC toolset lib\x64 + SDK ucrt\um x64
                 - user INCLUDE : newest MSVC toolset include + SDK headers
               Idempotent; re-run after a Visual Studio or SDK upgrade.

  Stage 1 runs `pnpm --filter "./packages/*" run build` instead of the repo's
  `build:deps` filter `'@pi-desktop/desktop^...'`. On Windows the caret is eaten
  while the argument travels through the cmd.exe shim chain, so the selector
  reaches pnpm as `@pi-desktop/desktop...` and matches zero projects. A path
  filter has no caret and selects the same six packages, in dependency order.

  Why `-Setup` persists instead of the build injecting an environment: a bare
  shell has no vcvars environment, so link.exe cannot find libcmt.lib /
  kernel32.lib and cl.exe cannot find its headers. Building that by hand per run
  is fragile (and vcvars64.bat itself shells out to reg.exe), so it is resolved
  once and written to the user environment.

.PARAMETER Setup
  Repair the environment, then exit. Combine with -DryRun to preview.

.PARAMETER DryRun
  With -Setup: report what would be written without changing anything.

.PARAMETER VsRoot
  With -Setup: Visual Studio install root, e.g. 'D:\Program Files\vs'.
  Probed from common locations when omitted.

.PARAMETER WindowsSdkRoot
  With -Setup: Windows SDK root. Defaults to 'C:\Program Files (x86)\Windows Kits\10'.

.PARAMETER Clean
  Build mode: remove apps/desktop/out and apps/desktop/release first.

.PARAMETER SkipDeps
  Build mode: skip stage 1.

.PARAMETER SkipPackage
  Build mode: stop after stage 4 (no electron-builder run).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File build-win.ps1 -Setup -DryRun
  powershell -ExecutionPolicy Bypass -File build-win.ps1 -Setup
  powershell -ExecutionPolicy Bypass -File build-win.ps1
  powershell -ExecutionPolicy Bypass -File build-win.ps1 -Clean
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
  [switch]$Setup,
  [switch]$DryRun,
  [string]$VsRoot,
  [string]$WindowsSdkRoot = 'C:\Program Files (x86)\Windows Kits\10',
  [switch]$Clean,
  [switch]$SkipDeps,
  [switch]$SkipPackage
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

# --- helpers -------------------------------------------------------------------
function Write-Head([string]$Text) { Write-Host ''; Write-Host $Text -ForegroundColor Cyan }
function Write-Ok([string]$Text)   { Write-Host "  $Text" }
function Write-Check([string]$Text){ Write-Host "  [ok]   $Text" }
function Write-Warn2([string]$Text){ Write-Host "  [warn] $Text" -ForegroundColor Yellow }
function Write-Bad([string]$Text)  { Write-Host "  [miss] $Text" -ForegroundColor Red }
function Stop-Step([string]$Text) {
  Write-Host ''
  Write-Host "[FAIL] $Text" -ForegroundColor Red
  exit 1
}

function Get-Newest-Child {
  # Newest directory under $Path that contains $Probe, compared by version name.
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Probe
  )
  if (-not (Test-Path $Path)) { return $null }
  $dirs = Get-ChildItem -Path $Path -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName $Probe) } |
    Sort-Object -Property @{ Expression = { try { [version]$_.Name } catch { [version]'0.0' } } } -Descending
  if (-not $dirs) { return $null }
  return $dirs[0]
}

function Add-UserPathEntry {
  # Prepend $Dir to the persistent user PATH when missing. True when written.
  param([Parameter(Mandatory)][string]$Dir)
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  $entries = @()
  if ($current) { $entries = @($current -split ';' | Where-Object { $_.Trim() -ne '' }) }
  foreach ($e in $entries) {
    if ($e.TrimEnd('\') -ieq $Dir.TrimEnd('\')) { return $false }
  }
  if (-not $DryRun) {
    [Environment]::SetEnvironmentVariable('Path', ((@($Dir) + $entries) -join ';'), 'User')
  }
  return $true
}

function Set-UserVariable {
  # Set a persistent user environment variable. True when it changed.
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Value
  )
  if ([Environment]::GetEnvironmentVariable($Name, 'User') -eq $Value) { return $false }
  if (-not $DryRun) { [Environment]::SetEnvironmentVariable($Name, $Value, 'User') }
  return $true
}

function Invoke-Stage {
  # Run one build stage; stop the build when the native command fails.
  param(
    [Parameter(Mandatory)][string]$Title,
    [Parameter(Mandatory)][scriptblock]$Command
  )
  Write-Head $Title
  & $Command
  if ($LASTEXITCODE -ne 0) { Stop-Step "$Title failed (exit $LASTEXITCODE)" }
}

# =============================================================================
# Mode: -Setup  (check + repair the environment)
# =============================================================================
if ($Setup) {

  # --- prerequisites -----------------------------------------------------------
  Write-Head 'Prerequisites'
  $missing = @()
  foreach ($tool in 'node', 'pnpm', 'cargo', 'rustc') {
    $cmd = Get-Command $tool -ErrorAction SilentlyContinue
    if (-not $cmd) {
      Write-Bad "$tool not found in PATH"
      $missing += $tool
      continue
    }
    Write-Check ("{0,-6} {1}" -f $tool, (& $cmd.Source --version 2>$null | Select-Object -First 1))
  }
  if ($missing.Count -gt 0) {
    Write-Host ''
    Write-Host 'Install the missing tools, then re-run -Setup:' -ForegroundColor Yellow
    Write-Host '  Node 22+  : https://nodejs.org        (or: winget install OpenJS.NodeJS.LTS)'
    Write-Host '  pnpm      : corepack enable pnpm'
    Write-Host '  Rust MSVC : https://rustup.rs         (rustup default stable-x86_64-pc-windows-msvc)'
    exit 1
  }

  $hostTriple = (& rustc -vV | Select-String -Pattern '^host:' | Select-Object -First 1).ToString()
  $hostTriple = ($hostTriple -replace '^host:\s*', '').Trim()
  if ($hostTriple -ne 'x86_64-pc-windows-msvc') {
    Write-Bad "rustc host is '$hostTriple', expected 'x86_64-pc-windows-msvc'"
    Write-Host '  Run: rustup default stable-x86_64-pc-windows-msvc' -ForegroundColor Yellow
    exit 1
  }
  Write-Check "rustc host  $hostTriple"

  # --- Visual Studio C++ toolset ------------------------------------------------
  Write-Head 'Visual Studio C++ toolset'
  if (-not $VsRoot) {
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($env:VSINSTALLDIR) { $candidates.Add($env:VSINSTALLDIR.TrimEnd('\')) }
    foreach ($p in 'D:\Program Files\vs', 'C:\Program Files\vs', 'D:\Program Files (x86)\vs') {
      $candidates.Add($p)
    }
    foreach ($base in 'C:\Program Files\Microsoft Visual Studio',
                      'C:\Program Files (x86)\Microsoft Visual Studio',
                      'D:\Program Files\Microsoft Visual Studio') {
      if (Test-Path $base) {
        foreach ($year in Get-ChildItem -Path $base -Directory -ErrorAction SilentlyContinue) {
          foreach ($edition in Get-ChildItem -Path $year.FullName -Directory -ErrorAction SilentlyContinue) {
            $candidates.Add($edition.FullName)
          }
        }
      }
    }
    foreach ($c in $candidates) {
      if (Test-Path (Join-Path $c 'VC\Tools\MSVC')) { $VsRoot = $c.TrimEnd('\'); break }
    }
  }
  if (-not $VsRoot -or -not (Test-Path (Join-Path $VsRoot 'VC\Tools\MSVC'))) {
    Write-Bad 'Visual Studio C++ toolset not found'
    Write-Host '  Install "Visual Studio 2022/2026" with the "Desktop development with C++" workload,' -ForegroundColor Yellow
    Write-Host '  or pass the install root explicitly: -VsRoot "D:\Program Files\vs"' -ForegroundColor Yellow
    exit 1
  }
  Write-Check "VS root     $VsRoot"

  $toolset = Get-Newest-Child -Path (Join-Path $VsRoot 'VC\Tools\MSVC') -Probe 'bin\Hostx64\x64\link.exe'
  if (-not $toolset) { Write-Bad "no x64 toolset (link.exe) under $VsRoot\VC\Tools\MSVC"; exit 1 }
  $msvcBin = Join-Path $toolset.FullName 'bin\Hostx64\x64'
  $msvcLib = Join-Path $toolset.FullName 'lib\x64'
  $msvcInc = Join-Path $toolset.FullName 'include'
  Write-Check "toolset     $($toolset.Name)"

  foreach ($required in 'link.exe', 'cl.exe') {
    if (-not (Test-Path (Join-Path $msvcBin $required))) { Write-Bad "missing $required in $msvcBin"; exit 1 }
  }
  if (-not (Test-Path (Join-Path $msvcLib 'libcmt.lib'))) {
    Write-Bad "missing MSVC x64 CRT: $(Join-Path $msvcLib 'libcmt.lib')"; exit 1
  }

  # --- Windows SDK --------------------------------------------------------------
  Write-Head 'Windows SDK'
  $sdk = Get-Newest-Child -Path (Join-Path $WindowsSdkRoot 'Lib') -Probe 'um\x64\kernel32.lib'
  if (-not $sdk) {
    Write-Bad "no Windows SDK with x64 libs under $WindowsSdkRoot\Lib"
    Write-Host '  Install the "Windows 10/11 SDK" component in the Visual Studio installer.' -ForegroundColor Yellow
    exit 1
  }
  Write-Check "version     $($sdk.Name)"

  $sdkLib = $sdk.FullName
  $sdkInc = Join-Path (Join-Path $WindowsSdkRoot 'Include') $sdk.Name
  foreach ($required in 'um\x64\kernel32.lib', 'ucrt\x64\libucrt.lib') {
    if (-not (Test-Path (Join-Path $sdkLib $required))) { Write-Bad "missing $required under $sdkLib"; exit 1 }
  }

  # --- apply --------------------------------------------------------------------
  $cargoBin = Split-Path -Parent (Get-Command cargo).Source
  $libValue = (@($msvcLib, (Join-Path $sdkLib 'ucrt\x64'), (Join-Path $sdkLib 'um\x64')) -join ';')
  $includeValue = (@(
      $msvcInc,
      (Join-Path $sdkInc 'ucrt'),
      (Join-Path $sdkInc 'um'),
      (Join-Path $sdkInc 'shared'),
      (Join-Path $sdkInc 'winrt'),
      (Join-Path $sdkInc 'cppwinrt')
    ) -join ';')

  Write-Head $(if ($DryRun) { 'Would write (DryRun)' } else { 'Writing user environment' })

  if (Add-UserPathEntry -Dir $cargoBin) { Write-Check "PATH    += $cargoBin" }
  else { Write-Warn2 "PATH     already has $cargoBin" }
  if (Add-UserPathEntry -Dir $msvcBin) { Write-Check "PATH    += $msvcBin" }
  else { Write-Warn2 "PATH     already has $msvcBin" }
  if (Set-UserVariable -Name 'LIB' -Value $libValue) { Write-Check 'LIB      set (MSVC lib\x64 + SDK ucrt\um x64)' }
  else { Write-Warn2 'LIB      already up to date' }
  if (Set-UserVariable -Name 'INCLUDE' -Value $includeValue) { Write-Check 'INCLUDE  set (MSVC include + SDK headers)' }
  else { Write-Warn2 'INCLUDE  already up to date' }

  # Make it usable in this session too, so a build can follow without a new window.
  if (-not $DryRun) {
    foreach ($d in @($cargoBin, $msvcBin)) {
      if ($env:Path -notlike "*$d*") { $env:Path = "$d;$env:Path" }
    }
    $env:LIB = $libValue
    $env:INCLUDE = $includeValue
  }

  Write-Head 'Summary'
  if ($DryRun) {
    Write-Host '  DryRun: nothing was written.' -ForegroundColor Yellow
  } else {
    Write-Host '  Environment is ready; new PowerShell windows inherit it automatically.'
    Write-Host '  Now build with:  powershell -ExecutionPolicy Bypass -File build-win.ps1'
  }
  Write-Host '  To undo: System Properties -> Environment Variables -> User variables:'
  Write-Host '  remove the two PATH entries plus LIB and INCLUDE.'
  exit 0
}

# =============================================================================
# Mode: build (default)
# =============================================================================
Write-Head 'Preflight'
$missing = @()
foreach ($tool in 'node', 'pnpm', 'cargo', 'rustc', 'link.exe', 'cl.exe') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { $missing += $tool }
}
if ($missing.Count -gt 0) {
  Stop-Step ("not on PATH: {0}`n         Run:  powershell -ExecutionPolicy Bypass -File build-win.ps1 -Setup" -f ($missing -join ', '))
}
if (-not $env:LIB -or -not $env:INCLUDE) {
  Stop-Step "LIB / INCLUDE are not set.`n         Run:  powershell -ExecutionPolicy Bypass -File build-win.ps1 -Setup"
}
Write-Ok "node    $(& node --version)"
Write-Ok "pnpm    $(& pnpm --version)"
Write-Ok "rust    $(& rustc -V)"

$pnpm = (Get-Command pnpm).Source

# --- clean ---------------------------------------------------------------------
if ($Clean) {
  Write-Head 'Clean'
  foreach ($dir in 'apps/desktop/out', 'apps/desktop/release') {
    if (Test-Path $dir) {
      Remove-Item -LiteralPath $dir -Recurse -Force
      Write-Ok "removed $dir"
    }
  }
}

# --- stage 1: TS workspace packages --------------------------------------------
if ($SkipDeps) {
  Write-Head '[1/5] skipped (-SkipDeps)'
} else {
  Invoke-Stage '[1/5] building TS workspace packages' {
    & $pnpm --filter "./packages/*" run build
  }
}

# --- stage 2: Rust host core ----------------------------------------------------
Invoke-Stage '[2/5] building host-core (release)' {
  & cargo build --release -p host-core
}
$hostExe = 'target/release/pi-desktop-host-core.exe'
if (-not (Test-Path $hostExe)) { Stop-Step "missing $hostExe" }
Write-Ok ("{0}  {1:N1} MB" -f $hostExe, ((Get-Item $hostExe).Length / 1MB))

# --- stage 3: agent sidecar bundle ---------------------------------------------
Invoke-Stage '[3/5] bundling agent-runtime sidecar' {
  & $pnpm -C packages/agent-runtime bundle
}
$sidecar = 'packages/agent-runtime/dist-bundle/sidecar.js'
if (-not (Test-Path $sidecar)) { Stop-Step "missing $sidecar" }

# --- stage 4: electron app ------------------------------------------------------
Invoke-Stage '[4/5] building electron app' {
  & $pnpm -C apps/desktop run build
}
if (-not (Test-Path 'apps/desktop/out/main/index.js')) {
  Stop-Step 'missing apps/desktop/out/main/index.js'
}

if ($SkipPackage) {
  Write-Head '[5/5] skipped (-SkipPackage)'
  Write-Host ''
  Write-Host '[DONE] app built (no installer requested)'
  exit 0
}

# --- stage 5: electron-builder (nsis + portable) --------------------------------
Push-Location 'apps/desktop'
try {
  Invoke-Stage '[5/5] packaging (nsis + portable)' {
    & $pnpm exec electron-builder --win --publish never
  }
} finally {
  Pop-Location
}

# --- verify artifacts -----------------------------------------------------------
$release = 'apps/desktop/release'
foreach ($packed in "$release/win-unpacked/resources/bin/pi-desktop-host-core.exe",
                    "$release/win-unpacked/resources/agent-runtime/sidecar.js") {
  if (-not (Test-Path $packed)) { Stop-Step "missing $packed inside package" }
}

# Only this version's installers: a stale build must never be listed or
# published to the project root.
$appVersion = (Get-Content 'apps/desktop/package.json' -Raw | ConvertFrom-Json).version
$packages = @(Get-ChildItem -Path $release -Filter '*.exe' -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -eq "PI-Desktop-Setup-$appVersion.exe" -or
      $_.Name -eq "PI-Desktop-Portable-$appVersion.exe"
  })
if ($packages.Count -eq 0) { Stop-Step "no installers for $appVersion found in $release" }

Write-Head "Artifacts ($appVersion)"
foreach ($pkg in $packages | Sort-Object Name) {
  Write-Ok ("{0,-42} {1,7:N1} MB  {2}" -f $pkg.Name, ($pkg.Length / 1MB), (Get-FileHash $pkg.FullName -Algorithm SHA256).Hash)
}

# --- publish to the project root (newest version stays easy to find) -----------
Write-Head 'Publishing to the project root'
foreach ($pkg in $packages) {
  try {
    Copy-Item -LiteralPath $pkg.FullName -Destination (Join-Path $Root $pkg.Name) -Force -ErrorAction Stop
    Write-Ok "$($pkg.Name) -> $Root"
  } catch {
    Write-Warn2 "could not refresh $($pkg.Name) in $Root (is that copy running?)"
  }
}

Write-Host ''
Write-Host '[DONE] both packages built, resources verified, installers published to the project root'
