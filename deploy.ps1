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

Write-Host "Purging jsDelivr..."
try { Invoke-RestMethod $PurgeUrl -TimeoutSec 30 | Out-Null } catch {}
try { Invoke-RestMethod $DashboardPurgeUrl -TimeoutSec 30 | Out-Null } catch {}

$maxRetries = 10
$sleepSecs = 8
$ok = $false

Write-Host "Verifying @main against git commit $HeadSha..."
for ($i = 1; $i -le $maxRetries; $i++) {
    $rawHash = Get-UrlHash $RawShaUrl
    $mainHash = Get-UrlHash $CdnUrl
    $shaHash = Get-UrlHash $ShaCdnUrl

    if ($rawHash -and $mainHash -and $rawHash -eq $mainHash) {
        Write-Host "OK: jsDelivr @main is synced."
        $ok = $true
        break
    }

    Write-Host "Attempt ${i}/${maxRetries}: @main not synced yet."
    if ($rawHash -and $shaHash -and $rawHash -eq $shaHash) {
        Write-Host "Commit URL already correct: $ShaCdnUrl"
    }

    try { Invoke-RestMethod $PurgeUrl -TimeoutSec 30 | Out-Null } catch {}
    Start-Sleep -Seconds $sleepSecs
}

if (-not $ok) {
    Write-Host "WARNING: @main still not synced after retries."
    Write-Host "Temporary URL: $ShaCdnUrl"
}

Write-Host "Done."
