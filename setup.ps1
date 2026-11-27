# BrowserQuiz setup for Windows. Makes .env (asks for a teacher password and what students write code
# in, generates the other secrets), picks a free port, then downloads and starts everything.
# Safe to run again (it updates).
# Easiest: double-click setup.cmd. Or: powershell -ExecutionPolicy Bypass -File setup.ps1 [-Languages] [-Build | -NoBuild]
#   -Languages: ask again what students write code in.
#   -Build: build the images here instead of downloading them. -NoBuild: start with the images already here.
param([switch]$Languages, [switch]$Build, [switch]$NoBuild)
$mode = if ($Build) { 'build' } elseif ($NoBuild) { 'none' } else { 'pull' }
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

# A check is + when it's fine, ! when it's not but setup goes on, x when setup can't
function Write-Check([string]$Mark, [string]$What, [string]$Text) {
  $color = @{ '+' = 'Green'; '!' = 'Yellow'; 'x' = 'Red' }[$Mark]
  Write-Host "$Mark " -ForegroundColor $color -NoNewline
  Write-Host $What.PadRight(15) -NoNewline
  Write-Host $Text
}
function Stop-Setup([string]$What, [string]$Text) { Write-Check 'x' $What $Text; Write-Host ''; exit 1 }
function Get-DockerInfo([string]$Format) { $v = docker info --format $Format 2>$null; if ($LASTEXITCODE -eq 0) { "$v".Trim() } else { '' } }
function Test-Reach([string]$Url) { # any answer at all, an error status included, means it can be reached
  try { Invoke-WebRequest -UseBasicParsing -Method Head -TimeoutSec 6 -Uri $Url | Out-Null; return $true }
  catch { return [bool]$_.Exception.Response }
}

Write-Host ''
Write-Host 'BrowserQuiz setup' -ForegroundColor White
Write-Host ''

# ---------- this computer ----------
Write-Host 'Checking this computer' -ForegroundColor White
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Stop-Setup 'Docker' 'not installed: https://www.docker.com/products/docker-desktop/' }
docker info 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-Setup 'Docker' "not running: open Docker Desktop, wait for 'Engine running', then run this again" }
$compose = docker compose version --short 2>$null
if ($LASTEXITCODE -ne 0 -or -not $compose) { Stop-Setup 'Compose' 'not installed: https://docs.docker.com/compose/install/' }
$server = docker version --format '{{.Server.Version}}' 2>$null
Write-Check '+' 'Docker' "$server (Compose $("$compose".Trim().TrimStart('v')))"
# The code sandbox needs Linux 5.13+ (Landlock) on a 64-bit processor; without them all but code questions works
$arch = Get-DockerInfo '{{.Architecture}}'
$cpu = if (@('x86_64', 'amd64') -contains $arch) { '64-bit Intel/AMD' } elseif (@('aarch64', 'arm64') -contains $arch) { '64-bit ARM' } else { '' }
$kv = [regex]::Match((Get-DockerInfo '{{.KernelVersion}}'), '^(\d+)\.(\d+)')
$system = if ((Get-DockerInfo '{{.OperatingSystem}}') -like '*Docker Desktop*') { 'Docker Desktop' } else { "Linux $($kv.Groups[1].Value).$($kv.Groups[2].Value)" }
$oldKernel = $kv.Success -and ([int]$kv.Groups[1].Value -lt 5 -or ([int]$kv.Groups[1].Value -eq 5 -and [int]$kv.Groups[2].Value -lt 13))
if ($oldKernel) { Write-Check '!' 'System' "${system}: code questions need Linux 5.13+ (the rest works)" }
elseif (-not $cpu) { Write-Check '!' 'System' "${system}, ${arch}: code questions need 64-bit (the rest works)" }
else { Write-Check '+' 'System' "${system}, $cpu" }
$mem = 0L
[void][long]::TryParse((Get-DockerInfo '{{.MemTotal}}'), [ref]$mem)
if ($mem -gt 0) {
  $gb = '{0:0.0}' -f ($mem / 1GB)
  if ($mem -lt 1900000000) { Write-Check '!' 'Memory' "$gb GB for Docker: tight for a class (2 GB+ is better)" }
  else { Write-Check '+' 'Memory' "$gb GB for Docker" }
}
# (Docker Desktop keeps images in its own virtual machine, so there's no disk here to check)
if ($mode -eq 'pull') {
  if (Test-Reach 'https://ghcr.io/v2/') { Write-Check '+' 'Internet' 'can reach GitHub' }
  elseif (Test-Reach 'https://registry-1.docker.io/v2/') { Write-Check '!' 'Internet' "can't reach GitHub: building here instead (10+ min)"; $mode = 'build' }
  else {
    docker image inspect ghcr.io/areng14/browserquiz-app:latest 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Check '!' 'Internet' "offline: starting the copy that's already here"; $mode = 'none' }
    else { Stop-Setup 'Internet' 'offline: BrowserQuiz has to download once (about 220 MB)' }
  }
}
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
if ($mode -eq 'pull') {
  Write-Host 'Downloading BrowserQuiz...' -ForegroundColor White
  # A network that blocks the download: up builds what's missing here instead (10+ minutes the first time)
  docker compose pull --ignore-pull-failures app runner
  if ($LASTEXITCODE -ne 0) { Write-Host "Couldn't download the images: building them here instead." }
  Write-Host ''
}
Write-Host 'Starting BrowserQuiz...' -ForegroundColor White
if ($mode -eq 'build') { docker compose up -d --build } else { docker compose up -d }
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
  Write-Host 'x ' -ForegroundColor Red -NoNewline
  Write-Host "BrowserQuiz didn't start. Here's what it said:"
  Write-Host ''
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
