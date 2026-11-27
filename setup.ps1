# BrowserQuiz setup for Windows. Makes .env (asks for a teacher password and what students write code
# in, generates the other secrets), picks a free port, then downloads and starts everything.
# Safe to run again (it updates).
# Easiest: double-click setup.cmd. Or: powershell -ExecutionPolicy Bypass -File setup.ps1 [-Languages] [-Build | -NoBuild]
#   -Languages: ask again what students write code in.
#   -Build: build the images here instead of downloading them. -NoBuild: start with the images already here.
param([switch]$Languages, [switch]$Build, [switch]$NoBuild)
Set-Location -LiteralPath $PSScriptRoot

function New-RandomString([int]$Length, [string]$Chars) {
  $bytes = New-Object byte[] $Length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  -join ($bytes | ForEach-Object { $Chars[$_ % $Chars.Length] })
}
function New-Secret { New-RandomString 32 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' }
function New-Password {
  $s = New-RandomString 12 'abcdefghjkmnpqrstuvwxyz23456789'
  '{0}-{1}-{2}' -f $s.Substring(0, 4), $s.Substring(4, 4), $s.Substring(8, 4)
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "Docker isn't installed. Get Docker Desktop: https://www.docker.com/products/docker-desktop/"
  exit 1
}
docker info 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Docker isn't running. Open Docker Desktop, wait for 'Engine running', then run this again."
  exit 1
}
Write-Host ''
Write-Host 'BrowserQuiz setup' -ForegroundColor White
Write-Host ''

# ---------- .env ----------
$envPath = Join-Path $PSScriptRoot '.env'
$script:lines = @()
if (Test-Path -LiteralPath $envPath) { $script:lines = @(Get-Content -LiteralPath $envPath) }

function Get-EnvValue([string]$Key) {
  $line = $script:lines | Where-Object { $_.StartsWith("$Key=") } | Select-Object -Last 1
  if ($line) { return $line.Substring($Key.Length + 1).Trim() }
  return ''
}
function Set-EnvValue([string]$Key, [string]$Value) {
  $found = $false
  $out = @()
  foreach ($line in $script:lines) {
    if ($line.StartsWith("$Key=")) { $out += "$Key=$Value"; $found = $true } else { $out += $line }
  }
  if (-not $found) { $out += "$Key=$Value" }
  $script:lines = $out
}

# A question starts with ?, and once answered there's a line "+ What  answer"
function Write-Answered([string]$What, [string]$Answer) {
  Write-Host '+ ' -ForegroundColor Green -NoNewline
  Write-Host $What.PadRight(15) -NoNewline
  Write-Host $Answer
}

$newPassword = ''
$pw = Get-EnvValue 'ADMIN_PASSWORD'
if ($pw.Length -lt 10) {
  if ($pw) { Write-Host 'The admin password in .env is too short.' }
  $pw = ''
  while ($true) {
    Write-Host '? ' -ForegroundColor Cyan -NoNewline
    $secure = Read-Host 'Admin password (10+ characters, or Enter to make one up)' -AsSecureString
    $pw = (New-Object System.Net.NetworkCredential('', $secure)).Password
    if ($pw.Length -eq 0 -or $pw.Length -ge 10) { break }
    Write-Host 'Needs 10+ characters.'
  }
  if ($pw.Length -eq 0) { $pw = New-Password; $newPassword = $pw }
  Set-EnvValue 'ADMIN_PASSWORD' $pw
  Write-Answered 'Admin password' $(if ($newPassword) { 'made up (shown at the end)' } else { 'set' })
  Write-Host ''
}
# Too short means the app never started with it, so no roster depends on it yet.
if ((Get-EnvValue 'ID_PEPPER').Length -lt 12) { Set-EnvValue 'ID_PEPPER' (New-Secret) }
if ((Get-EnvValue 'RUNNER_TOKEN').Length -lt 16) { Set-EnvValue 'RUNNER_TOKEN' (New-Secret) }
# What students write code in: the code runner's languages (RUNNER_LANGS). Asked the first time, and with
# -Languages; without a console, the smaller one.
if ($Languages -or @('standard', 'full') -notcontains (Get-EnvValue 'RUNNER_LANGS')) {
  $langs = 'standard'
  if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
    Write-Host '? ' -ForegroundColor Cyan -NoNewline
    Write-Host 'What will students write code in?'
    Write-Host '  1  Java, Python, JavaScript, TypeScript'
    Write-Host '  2  All nine: also C, C++, C#, Go, Rust  ' -NoNewline
    Write-Host '(bigger download)' -ForegroundColor DarkGray
    do { $pick = Read-Host '  1 or 2 (Enter for 1)' } while (@('', '1', '2') -notcontains $pick.Trim())
    if ($pick.Trim() -eq '2') { $langs = 'full' }
    Write-Answered 'Languages' $(if ($langs -eq 'full') { 'All nine: also C, C++, C#, Go, Rust' } else { 'Java, Python, JavaScript, TypeScript' })
    Write-Host ''
  }
  Set-EnvValue 'RUNNER_LANGS' $langs
}

function Save-Env {
  # Plain UTF-8 (no BOM) with Unix line endings, which docker compose reads cleanly.
  $text = ($script:lines -join "`n") + "`n"
  [System.IO.File]::WriteAllText($envPath, $text, (New-Object System.Text.UTF8Encoding($false)))
}
Save-Env
# Only this Windows account can read .env (it holds the teacher password and secrets).
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls $envPath /inheritance:r /grant:r "${me}:(F)" *> $null
if ($LASTEXITCODE -ne 0) { Write-Warning "Couldn't limit who can read .env. Keep this folder private." }

# ---------- port ----------
function Test-PortInUse([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $wait = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    return ($wait.AsyncWaitHandle.WaitOne(300) -and $client.Connected)
  } catch { return $false } finally { $client.Close() }
}

$port = Get-EnvValue 'APP_PORT'
if (-not $port) {
  $mapped = docker compose port app 8080 2>$null | Select-Object -First 1   # already running: keep it
  if ($mapped -and "$mapped" -match ':(\d+)\s*$') {
    $port = $Matches[1]
  } else {
    $port = 8080
    while (Test-PortInUse $port) { $port++ }
    if ($port -ne 8080) {
      Write-Answered 'Port' "$port  (8080 is taken)"
      Write-Host ''
      Set-EnvValue 'APP_PORT' "$port"
      Save-Env
    }
  }
}

# ---------- start ----------
# This computer's address on the network: the app shows it as where students join, instead of localhost
$ip = $null
try {
  $cfg = Get-NetIPConfiguration -ErrorAction Stop | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1
  if ($cfg) { $ip = @($cfg.IPv4Address)[0].IPAddress }
} catch { }
if ($ip) { $env:HOST_LAN_IP = $ip }
if (-not $Build -and -not $NoBuild) {
  Write-Host 'Downloading BrowserQuiz...' -ForegroundColor White
  # A network that blocks the download: up builds what's missing here instead (10+ minutes the first time)
  docker compose pull --ignore-pull-failures app runner
  if ($LASTEXITCODE -ne 0) { Write-Host "Couldn't download the images: building them here instead." }
  Write-Host ''
}
Write-Host 'Starting BrowserQuiz...' -ForegroundColor White
if ($Build) { docker compose up -d --build } else { docker compose up -d }
if ($LASTEXITCODE -ne 0) { Write-Host 'docker compose failed (see above).'; exit 1 }

Write-Host -NoNewline 'Waiting for it to answer'
$up = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://localhost:$port/healthz"
    if ($r.StatusCode -eq 200) { $up = $true; break }
  } catch { }
  Write-Host -NoNewline '.'
  Start-Sleep -Seconds 1
}
Write-Host ''
Start-Sleep -Seconds 2
$runnerLog = @(docker compose logs runner --tail 30 --no-log-prefix 2>$null)

if (-not $ip) { $ip = "<this computer's IP>" }

Write-Host ''
if (-not $up) {
  Write-Host "BrowserQuiz didn't come up. Here's what it said:"
  docker compose logs app --tail 15
  exit 1
}
function Write-Line([string]$What, [string]$Value, [string]$Note) {
  Write-Host ('  ' + $What.PadRight(13) + $Value) -NoNewline
  if ($Note) { Write-Host "  $Note" -ForegroundColor DarkGray } else { Write-Host '' }
}
Write-Host '+ ' -ForegroundColor Green -NoNewline
Write-Host 'BrowserQuiz is running' -ForegroundColor White
Write-Host ''
Write-Line 'Teacher' "http://localhost:$port/teacher"
Write-Line 'Students' "http://${ip}:$port"
if ($newPassword) { Write-Line 'Password' $newPassword '(saved in .env)' }
Write-Line 'Languages' $(if ((Get-EnvValue 'RUNNER_LANGS') -eq 'full') { 'all nine' } else { 'Java, Python, JavaScript, TypeScript' }) '(change: setup.cmd -Languages)'
if (($runnerLog -join "`n") -match 'sandbox ok') {
  Write-Line 'Code runner' 'OK'
} else {
  Write-Line 'Code runner' "not running, so code questions can't run or be graded:"
  $runnerLog | Where-Object { $_ -like '  - *' } | Sort-Object -Unique | ForEach-Object { Write-Host "  $_" }
}
