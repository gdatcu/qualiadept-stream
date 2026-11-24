<#
.SYNOPSIS
  Encrypts & uploads files/folders to your rclone encrypted vault and automatically triggers a Jellyfin library scan.

.EXAMPLES
  .\upload-vault.ps1 "C:\Users\George\Downloads\MyVideo.mp4"
  .\upload-vault.ps1 "C:\Users\George\Downloads\Folder" -VideosOnly
  .\upload-vault.ps1 "C:\Users\George\Downloads\Folder" -Subfolder "Trips" -Move
  .\upload-vault.ps1 -ConfigureScan
#>

param(
  [Parameter(Position = 0)]
  [string]$SourcePath,

  [string]$Subfolder = "",
  [switch]$Move,
  [switch]$VideosOnly,
  [switch]$ConfigureScan
)

$ErrorActionPreference = "Stop"
$ConfigFile = Join-Path $env:APPDATA "rclone\jellyfin-scan.json"
$DefaultServer = "https://media.qualiadept.eu"

if ($ConfigureScan) {
  Write-Host "Configure Automatic Jellyfin Library Scan" -ForegroundColor Cyan
  Write-Host "In Jellyfin: Dashboard -> API Keys -> '+' -> Name: VaultUploader -> copy the key." -ForegroundColor Gray
  $apiKey = Read-Host "Paste Jellyfin API Key"
  if ([string]::IsNullOrWhiteSpace($apiKey)) {
    Write-Host "Canceled (no API key entered)." -ForegroundColor Yellow
    exit 1
  }
  $dir = Split-Path -Parent $ConfigFile
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  @{ serverUrl = $DefaultServer; apiKey = $apiKey.Trim() } | ConvertTo-Json | Set-Content -Path $ConfigFile -Encoding UTF8
  Write-Host "Saved locally to $ConfigFile" -ForegroundColor Green
  exit 0
}

if ([string]::IsNullOrWhiteSpace($SourcePath)) {
  Write-Host "Usage: .\upload-vault.ps1 `"C:\path\to\file-or-folder`" [-Subfolder Name] [-Move] [-VideosOnly]" -ForegroundColor Yellow
  Write-Host "First-time auto-scan setup: .\upload-vault.ps1 -ConfigureScan" -ForegroundColor Gray
  exit 1
}

if (-not (Test-Path -LiteralPath $SourcePath)) {
  Write-Error "Path not found: $SourcePath"
  exit 1
}

if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) {
  Write-Error "rclone is not on PATH. Install with: winget install Rclone.Rclone"
  exit 1
}

$cmd = if ($Move) { "move" } else { "copy" }
$dest = if ([string]::IsNullOrWhiteSpace($Subfolder)) { "vault:" } else { "vault:$($Subfolder.Trim('/'))" }

$argsList = @($cmd, $SourcePath, $dest, "-P", "--transfers", "4")
if ($VideosOnly) {
  $argsList += @("--include", "*.{mp4,mkv,avi,mov,m4v,webm}")
}

Write-Host ""
Write-Host ">> Encrypting & uploading to $dest ($cmd)..." -ForegroundColor Cyan
& rclone @argsList
if ($LASTEXITCODE -ne 0) {
  Write-Error "rclone exited with code $LASTEXITCODE"
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Upload complete!" -ForegroundColor Green

if (Test-Path -LiteralPath $ConfigFile) {
  try {
    $cfg = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
    Write-Host "Waiting 10s for Oracle VM rclone poll, then triggering Jellyfin library scan..." -ForegroundColor Cyan
    Start-Sleep -Seconds 10
    Invoke-RestMethod `
      -Method Post `
      -Uri "$($cfg.serverUrl.TrimEnd('/'))/Library/Refresh" `
      -Headers @{ "X-Emby-Token" = $cfg.apiKey } | Out-Null
    Write-Host "Jellyfin library scan triggered!" -ForegroundColor Green
  } catch {
    Write-Warning "Upload succeeded, but could not trigger Jellyfin scan: $_"
  }
} else {
  Write-Host "Tip: Run '.\upload-vault.ps1 -ConfigureScan' once to auto-scan Jellyfin after every upload." -ForegroundColor Gray
}
