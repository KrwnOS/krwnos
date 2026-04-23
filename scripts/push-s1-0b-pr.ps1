# Push cursor/s1-0b-module-contract-reconcile and open a pre-filled PR page.
# Run in PowerShell: .\scripts\push-s1-0b-pr.ps1
$ErrorActionPreference = "Stop"

$repoRoot   = "C:\Apps\KrwnOS"
$branch     = "cursor/s1-0b-module-contract-reconcile"
$baseBranch = "cursor/mission-whitepaper-obligations"
$repoSlug   = "KrwnOS/krwnos"
$title      = "fix(contract): reconcile @krwnos/sdk and core.tasks typecheck drift"
$bodyPath   = "docs/agent-briefs/S1.0b-PR-body.md"

Set-Location $repoRoot

Write-Host "[1/2] Pushing $branch to origin..." -ForegroundColor Cyan
git push -u origin $branch
if ($LASTEXITCODE -ne 0) { throw "git push failed (exit $LASTEXITCODE)" }

Write-Host "[2/2] Opening pre-filled PR compare page..." -ForegroundColor Cyan
Add-Type -AssemblyName System.Web
$body = Get-Content -Raw -Path (Join-Path $repoRoot $bodyPath)
$encBody  = [System.Web.HttpUtility]::UrlEncode($body)
$encTitle = [System.Web.HttpUtility]::UrlEncode($title)
$url = "https://github.com/$repoSlug/compare/$baseBranch...$([uri]::EscapeDataString($branch))?quick_pull=1&title=$encTitle&body=$encBody"

# GitHub has a URL-length ceiling (~8KB). If we're over, open the plain compare
# page and copy the body to the clipboard so you can paste it.
if ($url.Length -gt 7500) {
    Write-Host "PR body is too long for a URL param; copying body to clipboard instead." -ForegroundColor Yellow
    Set-Clipboard -Value $body
    $url = "https://github.com/$repoSlug/compare/$baseBranch...$([uri]::EscapeDataString($branch))?quick_pull=1&title=$encTitle"
}

Start-Process $url
Write-Host "Done. Review + submit in the browser." -ForegroundColor Green
