# Generates minimal PNG icons for PWA manifest (requires Windows GDI+).
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "public\icons"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

function Write-IconPng([int]$size, [string]$outPath) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $graphics = [System.Drawing.Graphics]::FromImage($bmp)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::FromArgb(255, 24, 24, 27))
  $fontPx = [math]::Max(12, [int]($size / 5))
  $font = New-Object System.Drawing.Font "Segoe UI", $fontPx, ([System.Drawing.FontStyle]::Bold)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 234, 179, 8))
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
  $graphics.DrawString("K", $font, $brush, $rect, $format)
  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bmp.Dispose()
}

Write-IconPng 192 (Join-Path $dir "icon-192.png")
Write-IconPng 512 (Join-Path $dir "icon-512.png")
Write-Host "Wrote icon-192.png and icon-512.png to $dir"
