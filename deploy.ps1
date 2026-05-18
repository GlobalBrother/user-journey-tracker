param(
    [Parameter(Mandatory = $true)]
    [string]$CommitMessage,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Files
)

$ErrorActionPreference = 'Stop'

$Repo = 'GlobalBrother/user-journey-tracker'
$Branch = 'main'
$File = 'app-core.js'
$RepoDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$CdnUrl = "https://cdn.jsdelivr.net/gh/$Repo@$Branch/$File"
$PurgeUrl = "https://purge.jsdelivr.net/gh/$Repo@$Branch/$File"
$DashboardPurgeUrl = "https://purge.jsdelivr.net/gh/$Repo@$Branch/dashboard.html"

function Get-UrlHash([string]$Url) {
    try {
        $resp = Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 40
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($resp.Content)
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            $hashBytes = $sha.ComputeHash($bytes)
            return ([System.BitConverter]::ToString($hashBytes)).Replace('-', '').ToLower()
        }
        finally {
            $sha.Dispose()
        }
    }
    catch {
        return $null
    }
}

Write-Host "Commit + push..."
if (-not $Files -or $Files.Count -eq 0) {
    git -C $RepoDir add -A
}
else {
    git -C $RepoDir add -- $Files
}

try {
    git -C $RepoDir commit -m $CommitMessage | Out-Host
}
catch {
    Write-Host "(nothing new to commit)"
}

git -C $RepoDir push origin $Branch | Out-Host

$HeadSha = (git -C $RepoDir rev-parse --short HEAD).Trim()
$ShaCdnUrl = "https://cdn.jsdelivr.net/gh/$Repo@$HeadSha/$File"
$RawShaUrl = "https://raw.githubusercontent.com/$Repo/$HeadSha/$File"

Write-Host "Purging jsDelivr (single purge to avoid throttling)..."
$purgeResult = $null
try {
    $purgeResult = Invoke-RestMethod $PurgeUrl -TimeoutSec 30
} catch {}
try { Invoke-RestMethod $DashboardPurgeUrl -TimeoutSec 30 | Out-Null } catch {}

# Show purge throttle status
if ($purgeResult -and $purgeResult.paths) {
    $pathInfo = $purgeResult.paths.PSObject.Properties.Value | Select-Object -First 1
    if ($pathInfo.throttled) {
        $resetSecs = $pathInfo.throttlingReset
        $resetMins = [math]::Round($resetSecs / 60)
        Write-Host "WARNING: jsDelivr purge is throttled. Reset in ~${resetMins} minutes."
        Write-Host "Use commit URL directly until throttle resets:"
        Write-Host "  $ShaCdnUrl"
        Write-Host "Done."
        exit 0
    }
}

# Only verify once after purge — no retry loop (avoids re-purging and more throttling)
Write-Host "Verifying @main against git commit $HeadSha (waiting 15s for CDN propagation)..."
Start-Sleep -Seconds 15

$rawHash = Get-UrlHash $RawShaUrl
$mainHash = Get-UrlHash $CdnUrl
$shaHash = Get-UrlHash $ShaCdnUrl

if ($rawHash -and $mainHash -and $rawHash -eq $mainHash) {
    Write-Host "OK: jsDelivr @main is synced."
} else {
    Write-Host "NOTE: @main not yet synced (CDN may take a few minutes)."
    if ($rawHash -and $shaHash -and $rawHash -eq $shaHash) {
        Write-Host "Commit URL is live: $ShaCdnUrl"
    }
    Write-Host "Pagina va fi actualizata in cateva minute automat."
}

Write-Host "Done."
