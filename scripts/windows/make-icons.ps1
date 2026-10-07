# Regenerates the ANNA icons (a rounded green square with a white "A") with System.Drawing. No dependencies.
# The results are committed, so you only need this if you want to change the look:
#   scripts\windows\anna.ico, public\icons\anna-192.png, public\icons\anna-512.png, src\app\icon.png
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$green = [System.Drawing.ColorTranslator]::FromHtml('#2f5d50')   # --accent in src/app/globals.css

function New-AnnaPng([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $g.Clear([System.Drawing.Color]::Transparent)

        $r = [single]($size * 0.22)
        $d = $r * 2
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $path.AddArc(0, 0, $d, $d, 180, 90)
        $path.AddArc($size - $d, 0, $d, $d, 270, 90)
        $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
        $path.AddArc(0, $size - $d, $d, $d, 90, 90)
        $path.CloseFigure()
        $brush = New-Object System.Drawing.SolidBrush $green
        $g.FillPath($brush, $path)

        $font = New-Object System.Drawing.Font 'Segoe UI', ([single]($size * 0.5)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
        $format = New-Object System.Drawing.StringFormat
        $format.Alignment = [System.Drawing.StringAlignment]::Center
        $format.LineAlignment = [System.Drawing.StringAlignment]::Center
        $rect = New-Object System.Drawing.RectangleF 0, ([single]($size * 0.02)), $size, $size
        $g.DrawString('A', $font, [System.Drawing.Brushes]::White, $rect, $format)

        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        return , $ms.ToArray()
    } finally {
        $g.Dispose()
        $bmp.Dispose()
    }
}

function Save-Bytes([string]$relative, [byte[]]$bytes) {
    $full = Join-Path $root $relative
    New-Item -ItemType Directory -Force (Split-Path $full) | Out-Null
    [System.IO.File]::WriteAllBytes($full, $bytes)
    Write-Host "wrote $relative ($($bytes.Length) bytes)"
}

# ICO container holding PNG images (supported since Windows Vista).
$sizes = 16, 24, 32, 48, 64, 128, 256
$images = foreach ($s in $sizes) { , (New-AnnaPng $s) }
$ico = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $ico
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]$images[$i].Length); $w.Write([uint32]$offset)
    $offset += $images[$i].Length
}
foreach ($img in $images) { $w.Write([byte[]]$img) }
$w.Flush()
Save-Bytes 'scripts\windows\anna.ico' $ico.ToArray()

Save-Bytes 'public\icons\anna-192.png' (New-AnnaPng 192)
Save-Bytes 'public\icons\anna-512.png' (New-AnnaPng 512)
Save-Bytes 'src\app\icon.png' (New-AnnaPng 256)
