# Store icons — fullscreen frame + chat mark; simplify at tiny sizes.
# ストア用。全画面枠＋チャット。小さいサイズでは図柄を簡略化する。
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "public\icon"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$bg = [System.Drawing.Color]::FromArgb(255, 16, 24, 32)       # deep slate
$accent = [System.Drawing.Color]::FromArgb(255, 62, 148, 236) # brand blue
$card = [System.Drawing.Color]::FromArgb(255, 236, 242, 248)
$line = [System.Drawing.Color]::FromArgb(255, 11, 107, 203)

function New-RoundedRectPath(
  [System.Drawing.RectangleF]$rect,
  [float]$radius
) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [Math]::Max(1.0, $radius) * 2.0
  $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
  $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function Add-FullscreenFrame(
  [System.Drawing.Drawing2D.GraphicsPath]$path,
  [float]$x0,
  [float]$y0,
  [float]$x1,
  [float]$y1,
  [float]$arm,
  [float]$t
) {
  # Continuous L strokes as filled bands / 連続した L を帯で塗る
  # TL
  $path.AddPolygon(@(
      (New-Object System.Drawing.PointF $x0, $y0),
      (New-Object System.Drawing.PointF ($x0 + $arm), $y0),
      (New-Object System.Drawing.PointF ($x0 + $arm), ($y0 + $t)),
      (New-Object System.Drawing.PointF ($x0 + $t), ($y0 + $t)),
      (New-Object System.Drawing.PointF ($x0 + $t), ($y0 + $arm)),
      (New-Object System.Drawing.PointF $x0, ($y0 + $arm))
    ))
  # TR
  $path.AddPolygon(@(
      (New-Object System.Drawing.PointF $x1, $y0),
      (New-Object System.Drawing.PointF ($x1 - $arm), $y0),
      (New-Object System.Drawing.PointF ($x1 - $arm), ($y0 + $t)),
      (New-Object System.Drawing.PointF ($x1 - $t), ($y0 + $t)),
      (New-Object System.Drawing.PointF ($x1 - $t), ($y0 + $arm)),
      (New-Object System.Drawing.PointF $x1, ($y0 + $arm))
    ))
  # BL
  $path.AddPolygon(@(
      (New-Object System.Drawing.PointF $x0, $y1),
      (New-Object System.Drawing.PointF ($x0 + $arm), $y1),
      (New-Object System.Drawing.PointF ($x0 + $arm), ($y1 - $t)),
      (New-Object System.Drawing.PointF ($x0 + $t), ($y1 - $t)),
      (New-Object System.Drawing.PointF ($x0 + $t), ($y1 - $arm)),
      (New-Object System.Drawing.PointF $x0, ($y1 - $arm))
    ))
  # BR
  $path.AddPolygon(@(
      (New-Object System.Drawing.PointF $x1, $y1),
      (New-Object System.Drawing.PointF ($x1 - $arm), $y1),
      (New-Object System.Drawing.PointF ($x1 - $arm), ($y1 - $t)),
      (New-Object System.Drawing.PointF ($x1 - $t), ($y1 - $t)),
      (New-Object System.Drawing.PointF ($x1 - $t), ($y1 - $arm)),
      (New-Object System.Drawing.PointF $x1, ($y1 - $arm))
    ))
}

function New-Icon([int]$size, [string]$pathOut) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $s = [float]$size
  # Fill the canvas — less outer pad so the mark reads larger in the toolbar.
  # 外側の余白を減らしてキャンバスを使い、ツールバーで大きく表示されるようにする。
  $pad = [Math]::Max(0.5, $s * 0.02)
  $tile = New-Object System.Drawing.RectangleF $pad, $pad, ($s - 2 * $pad), ($s - 2 * $pad)
  $tilePath = New-RoundedRectPath $tile ([Math]::Max(2.0, $s * 0.18))
  $bgBrush = New-Object System.Drawing.SolidBrush $bg
  $g.FillPath($bgBrush, $tilePath)

  $inset = $s * 0.055
  $arm = $s * 0.22
  $thick = [Math]::Max(2.0, $s * 0.095)
  $frame = New-Object System.Drawing.Drawing2D.GraphicsPath
  Add-FullscreenFrame $frame ($pad + $inset) ($pad + $inset) ($s - $pad - $inset) ($s - $pad - $inset) $arm $thick
  $accentBrush = New-Object System.Drawing.SolidBrush $accent
  $g.FillPath($accentBrush, $frame)

  # Chat mark — fill more of the frame / 枠内を大きく埋める
  $scale = if ($size -le 16) { 0.7 } elseif ($size -le 32) { 0.64 } else { 0.6 }
  $cw = $s * $scale
  $ch = $cw * 0.68
  $cx = ($s - $cw) * 0.5
  $cy = ($s - $ch) * 0.38
  $cardRect = New-Object System.Drawing.RectangleF $cx, $cy, $cw, $ch
  $cardPath = New-RoundedRectPath $cardRect ([Math]::Max(1.5, $cw * 0.16))
  $cardBrush = New-Object System.Drawing.SolidBrush $card
  $g.FillPath($cardBrush, $cardPath)

  if ($size -ge 24) {
    $tail = @(
      (New-Object System.Drawing.PointF ($cx + $cw * 0.22), ($cy + $ch * 0.92)),
      (New-Object System.Drawing.PointF ($cx + $cw * 0.12), ($cy + $ch * 1.22)),
      (New-Object System.Drawing.PointF ($cx + $cw * 0.48), ($cy + $ch * 0.92))
    )
    $g.FillPolygon($cardBrush, $tail)
  }

  if ($size -ge 32) {
    $lineBrush = New-Object System.Drawing.SolidBrush $line
    $lh = [Math]::Max(1.5, $ch * 0.11)
    $gap = $ch * 0.17
    $lx = $cx + $cw * 0.14
    $ly = $cy + $ch * 0.26
    foreach ($w in @(0.66, 0.5, 0.36)) {
      if ($size -lt 48 -and $w -eq 0.36) { continue }
      $lw = $cw * $w
      $lineRect = New-Object System.Drawing.RectangleF $lx, $ly, $lw, $lh
      $linePath = New-RoundedRectPath $lineRect ($lh * 0.5)
      $g.FillPath($lineBrush, $linePath)
      $linePath.Dispose()
      $ly += $gap
    }
    $lineBrush.Dispose()
  } elseif ($size -ge 16) {
    # Single bar at 16px so the mark still reads as chat / 16 px では吹き出し内の線を 1 本にする
    $lineBrush = New-Object System.Drawing.SolidBrush $line
    $lh = [Math]::Max(1.2, $ch * 0.18)
    $lineRect = New-Object System.Drawing.RectangleF ($cx + $cw * 0.18), ($cy + $ch * 0.4), ($cw * 0.58), $lh
    $linePath = New-RoundedRectPath $lineRect ($lh * 0.5)
    $g.FillPath($lineBrush, $linePath)
    $linePath.Dispose()
    $lineBrush.Dispose()
  }

  $bmp.Save($pathOut, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  $bgBrush.Dispose()
  $accentBrush.Dispose()
  $cardBrush.Dispose()
  $tilePath.Dispose()
  $frame.Dispose()
  $cardPath.Dispose()
}

foreach ($size in 16, 32, 48, 128) {
  $target = Join-Path $outDir "$size.png"
  New-Icon $size $target
  Write-Host "wrote $target"
}

$svg = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="Fullscreen Chat">
  <rect x="1" y="1" width="126" height="126" rx="20" fill="#101820"/>
  <path fill="#3e94ec" d="M8 8h30v11H19v19H8V8zm112 0v30h-11V19H90V8h30zM8 120v-30h11v19h19v11H8zm112 0H90v-11h19V90h11v30z"/>
  <rect x="26" y="32" width="76" height="52" rx="12" fill="#ecf2f8"/>
  <path fill="#ecf2f8" d="M40 80l-7 18 24-18z"/>
  <rect x="38" y="44" width="46" height="7" rx="3.5" fill="#0b6bcb"/>
  <rect x="38" y="58" width="34" height="7" rx="3.5" fill="#0b6bcb"/>
  <rect x="38" y="72" width="24" height="7" rx="3.5" fill="#0b6bcb"/>
</svg>
"@
Set-Content -Path (Join-Path $outDir "icon.svg") -Value $svg -Encoding utf8
Write-Host "wrote icon.svg"
