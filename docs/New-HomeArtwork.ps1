param(
  [string]$OutputDirectory = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $projectRoot 'assets\home'
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $OutputDirectory.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Output directory must stay inside the project: $OutputDirectory"
}
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null

function Get-Color {
  param([string]$Hex, [int]$Alpha = 255)
  $base = [Drawing.ColorTranslator]::FromHtml($Hex)
  [Drawing.Color]::FromArgb($Alpha, $base.R, $base.G, $base.B)
}

function New-RoundedPath {
  param([single]$X, [single]$Y, [single]$Width, [single]$Height, [single]$Radius)
  $path = [Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  $path
}

function Fill-RoundedRectangle {
  param($Graphics, $Brush, [single]$X, [single]$Y, [single]$Width, [single]$Height, [single]$Radius)
  $path = New-RoundedPath $X $Y $Width $Height $Radius
  try { $Graphics.FillPath($Brush, $path) } finally { $path.Dispose() }
}

function Draw-RoundedRectangle {
  param($Graphics, $Pen, [single]$X, [single]$Y, [single]$Width, [single]$Height, [single]$Radius)
  $path = New-RoundedPath $X $Y $Width $Height $Radius
  try { $Graphics.DrawPath($Pen, $path) } finally { $path.Dispose() }
}

function Add-Glow {
  param($Graphics, [single]$X, [single]$Y, [single]$Width, [single]$Height, [string]$Hex, [int]$Alpha)
  $path = [Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddEllipse($X, $Y, $Width, $Height)
  $brush = [Drawing.Drawing2D.PathGradientBrush]::new($path)
  try {
    $brush.CenterColor = Get-Color $Hex $Alpha
    $brush.SurroundColors = [Drawing.Color[]]@((Get-Color $Hex 0))
    $Graphics.FillPath($brush, $path)
  } finally {
    $brush.Dispose()
    $path.Dispose()
  }
}

function New-LinePen {
  param([string]$Hex, [single]$Width, [int]$Alpha = 255)
  $pen = [Drawing.Pen]::new((Get-Color $Hex $Alpha), $Width)
  $pen.StartCap = [Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
  $pen
}

function Draw-Speaker {
  param($Graphics, [single]$CenterX, [single]$CenterY, [single]$Size, [string]$Accent)
  $outer = [Drawing.SolidBrush]::new((Get-Color '#07101d' 230))
  $ring = New-LinePen $Accent ($Size * .035) 225
  $innerRing = New-LinePen '#dff7ff' ($Size * .012) 120
  try {
    $Graphics.FillEllipse($outer, $CenterX - $Size / 2, $CenterY - $Size / 2, $Size, $Size)
    $Graphics.DrawEllipse($ring, $CenterX - $Size * .43, $CenterY - $Size * .43, $Size * .86, $Size * .86)
    $Graphics.DrawEllipse($innerRing, $CenterX - $Size * .32, $CenterY - $Size * .32, $Size * .64, $Size * .64)

    $conePath = [Drawing.Drawing2D.GraphicsPath]::new()
    $conePath.AddEllipse($CenterX - $Size * .3, $CenterY - $Size * .3, $Size * .6, $Size * .6)
    $coneBrush = [Drawing.Drawing2D.PathGradientBrush]::new($conePath)
    try {
      $coneBrush.CenterColor = Get-Color '#d7f5ff' 175
      $coneBrush.SurroundColors = [Drawing.Color[]]@((Get-Color '#15263f' 255))
      $Graphics.FillPath($coneBrush, $conePath)
    } finally {
      $coneBrush.Dispose()
      $conePath.Dispose()
    }

    $cap = [Drawing.SolidBrush]::new((Get-Color '#050a12' 245))
    $shine = [Drawing.SolidBrush]::new((Get-Color '#ffffff' 170))
    try {
      $Graphics.FillEllipse($cap, $CenterX - $Size * .105, $CenterY - $Size * .105, $Size * .21, $Size * .21)
      $Graphics.FillEllipse($shine, $CenterX - $Size * .045, $CenterY - $Size * .065, $Size * .045, $Size * .045)
    } finally {
      $cap.Dispose()
      $shine.Dispose()
    }
  } finally {
    $outer.Dispose()
    $ring.Dispose()
    $innerRing.Dispose()
  }
}

function Draw-Waveform {
  param($Graphics, [single]$Left, [single]$CenterY, [single]$Width, [single]$Height, [string]$Accent)
  $values = @(0, .2, -.32, .48, -.72, .9, -.42, .58, -.3, .18, 0)
  $points = [Collections.Generic.List[Drawing.PointF]]::new()
  for ($index = 0; $index -lt $values.Count; $index++) {
    $x = $Left + $Width * $index / ($values.Count - 1)
    $y = $CenterY - $Height * $values[$index] / 2
    $points.Add([Drawing.PointF]::new($x, $y))
  }
  $halo = New-LinePen $Accent 24 38
  $line = New-LinePen $Accent 9 245
  try {
    $Graphics.DrawLines($halo, $points.ToArray())
    $Graphics.DrawLines($line, $points.ToArray())
  } finally {
    $halo.Dispose()
    $line.Dispose()
  }
}

function Draw-LimiterArt {
  param($Graphics, [bool]$Knowledge)
  $speakerX = if ($Knowledge) { 830 } else { 860 }
  $speakerSize = if ($Knowledge) { 420 } else { 360 }
  Draw-Speaker $Graphics $speakerX 340 $speakerSize '#32ade6'
  Draw-Waveform $Graphics 90 355 690 245 '#42d8ff'
  $threshold = New-LinePen '#ffb340' 8 235
  $guard = New-LinePen '#ffffff' 3 90
  try {
    $Graphics.DrawLine($guard, 88, 214, 756, 214)
    $Graphics.DrawLine($threshold, 88, 214, 756, 214)
    $Graphics.DrawLine($guard, 88, 494, 756, 494)
  } finally {
    $threshold.Dispose()
    $guard.Dispose()
  }
}

function Draw-SplArt {
  param($Graphics, [bool]$Knowledge)
  Draw-Speaker $Graphics 250 340 300 '#8f8cff'
  $arcHalo = New-LinePen '#8f8cff' 30 28
  $arc = New-LinePen '#b8b6ff' 8 220
  try {
    foreach ($size in @(240, 390, 540, 690)) {
      $Graphics.DrawArc($arcHalo, 260 - $size / 2, 340 - $size / 2, $size, $size, -55, 110)
      $Graphics.DrawArc($arc, 260 - $size / 2, 340 - $size / 2, $size, $size, -55, 110)
    }
  } finally {
    $arcHalo.Dispose()
    $arc.Dispose()
  }
  $markerBrush = [Drawing.SolidBrush]::new((Get-Color '#5effd1' 245))
  $markerHalo = [Drawing.SolidBrush]::new((Get-Color '#5effd1' 38))
  $markerX = if ($Knowledge) { 1020 } else { 980 }
  try {
    $Graphics.FillEllipse($markerHalo, $markerX - 58, 282, 116, 116)
    $Graphics.FillEllipse($markerBrush, $markerX - 15, 325, 30, 30)
  } finally {
    $markerBrush.Dispose()
    $markerHalo.Dispose()
  }
  $distance = New-LinePen '#ffffff' 3 95
  try {
    $Graphics.DrawLine($distance, 410, 522, $markerX, 522)
    foreach ($x in @(410, 600, 790, $markerX)) { $Graphics.DrawLine($distance, $x, 505, $x, 540) }
  } finally { $distance.Dispose() }
}

function Draw-CableArt {
  param($Graphics, [bool]$Knowledge)
  $path = [Drawing.Drawing2D.GraphicsPath]::new()
  if ($Knowledge) {
    $path.AddBezier(80, 510, 330, 100, 760, 630, 1120, 190)
  } else {
    $path.AddBezier(60, 480, 350, 90, 730, 590, 1130, 220)
  }
  $outer = New-LinePen '#171c28' 92 255
  $jacket = New-LinePen '#ff9f0a' 64 245
  $core = New-LinePen '#ffe0a3' 25 245
  try {
    $Graphics.DrawPath($outer, $path)
    $Graphics.DrawPath($jacket, $path)
    $Graphics.DrawPath($core, $path)
  } finally {
    $outer.Dispose()
    $jacket.Dispose()
    $core.Dispose()
    $path.Dispose()
  }

  $ruler = New-LinePen '#ffffff' 3 85
  try {
    $Graphics.DrawLine($ruler, 110, 585, 1070, 585)
    for ($index = 0; $index -le 12; $index++) {
      $x = 110 + 80 * $index
      $tick = if ($index % 3 -eq 0) { 30 } else { 16 }
      $Graphics.DrawLine($ruler, $x, 585 - $tick, $x, 585 + $tick)
    }
  } finally { $ruler.Dispose() }

  $copperOuter = [Drawing.SolidBrush]::new((Get-Color '#24170e' 240))
  $copper = [Drawing.SolidBrush]::new((Get-Color '#ffb45f' 255))
  try {
    $Graphics.FillEllipse($copperOuter, 858, 118, 220, 220)
    foreach ($point in @(@(902, 158), @(970, 158), @(936, 220), @(1010, 224), @(892, 245))) {
      $Graphics.FillEllipse($copper, $point[0], $point[1], 54, 54)
    }
  } finally {
    $copperOuter.Dispose()
    $copper.Dispose()
  }
}

function Draw-VenueArt {
  param($Graphics, [bool]$Knowledge)
  $roomBrush = [Drawing.SolidBrush]::new((Get-Color '#f5fffa' 26))
  $roomPen = New-LinePen '#d8fff1' 4 125
  try {
    Fill-RoundedRectangle $Graphics $roomBrush 150 75 900 525 44
    Draw-RoundedRectangle $Graphics $roomPen 150 75 900 525 44
  } finally {
    $roomBrush.Dispose()
    $roomPen.Dispose()
  }

  $coneBrush = [Drawing.SolidBrush]::new((Get-Color '#34c759' 44))
  $fillBrush = [Drawing.SolidBrush]::new((Get-Color '#30d1be' 48))
  try {
    $leftCone = [Drawing.PointF[]]@(
      [Drawing.PointF]::new(205, 150), [Drawing.PointF]::new(240, 565), [Drawing.PointF]::new(600, 565)
    )
    $rightCone = [Drawing.PointF[]]@(
      [Drawing.PointF]::new(995, 150), [Drawing.PointF]::new(600, 565), [Drawing.PointF]::new(960, 565)
    )
    $fillCone = [Drawing.PointF[]]@(
      [Drawing.PointF]::new(250, 410), [Drawing.PointF]::new(340, 590), [Drawing.PointF]::new(610, 590)
    )
    $Graphics.FillPolygon($coneBrush, $leftCone)
    $Graphics.FillPolygon($coneBrush, $rightCone)
    $Graphics.FillPolygon($fillBrush, $fillCone)
  } finally {
    $coneBrush.Dispose()
    $fillBrush.Dispose()
  }

  $speakerBrush = [Drawing.SolidBrush]::new((Get-Color '#9bffca' 255))
  $speakerRing = New-LinePen '#ffffff' 4 180
  try {
    foreach ($point in @(@(205, 150), @(995, 150), @(250, 410), @(950, 410))) {
      $Graphics.FillEllipse($speakerBrush, $point[0] - 17, $point[1] - 17, 34, 34)
      $Graphics.DrawEllipse($speakerRing, $point[0] - 24, $point[1] - 24, 48, 48)
    }
  } finally {
    $speakerBrush.Dispose()
    $speakerRing.Dispose()
  }

  $tableBrush = [Drawing.SolidBrush]::new((Get-Color '#ffffff' 34))
  try { Fill-RoundedRectangle $Graphics $tableBrush 420 210 360 210 54 } finally { $tableBrush.Dispose() }
  $seatBrush = [Drawing.SolidBrush]::new((Get-Color '#d9fff0' 125))
  try {
    foreach ($x in @(450, 550, 650, 750)) {
      $Graphics.FillEllipse($seatBrush, $x - 16, 170, 32, 32)
      $Graphics.FillEllipse($seatBrush, $x - 16, 430, 32, 32)
    }
  } finally { $seatBrush.Dispose() }
}

function New-HomeArtwork {
  param([string]$Name, [string]$Primary, [string]$Secondary, [string]$Kind, [bool]$Knowledge)
  $width = 1200
  $height = 675
  $bitmap = [Drawing.Bitmap]::new($width, $height, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    $rect = [Drawing.Rectangle]::new(0, 0, $width, $height)
    $background = [Drawing.Drawing2D.LinearGradientBrush]::new($rect, (Get-Color '#07111f'), (Get-Color '#152b48'), 18)
    try { $graphics.FillRectangle($background, $rect) } finally { $background.Dispose() }

    Add-Glow $graphics 620 -260 860 860 $Primary 155
    Add-Glow $graphics -240 300 720 720 $Secondary 95
    Add-Glow $graphics 280 110 620 620 '#ffffff' 18

    $gridPen = New-LinePen '#ffffff' 1 16
    try {
      for ($x = 0; $x -le $width; $x += 100) { $graphics.DrawLine($gridPen, $x, 0, $x, $height) }
      for ($y = 0; $y -le $height; $y += 100) { $graphics.DrawLine($gridPen, 0, $y, $width, $y) }
    } finally { $gridPen.Dispose() }

    switch ($Kind) {
      'limiter' { Draw-LimiterArt $graphics $Knowledge }
      'spl' { Draw-SplArt $graphics $Knowledge }
      'cable' { Draw-CableArt $graphics $Knowledge }
      'venue' { Draw-VenueArt $graphics $Knowledge }
      default { throw "Unknown artwork kind: $Kind" }
    }

    $topHighlight = [Drawing.Drawing2D.LinearGradientBrush]::new(
      [Drawing.Rectangle]::new(0, 0, $width, 210),
      (Get-Color '#ffffff' 48),
      (Get-Color '#ffffff' 0),
      90
    )
    try { $graphics.FillRectangle($topHighlight, 0, 0, $width, 210) } finally { $topHighlight.Dispose() }

    $targetWidth = if ($Knowledge) { 1000 } else { 720 }
    $targetHeight = [int][Math]::Round($targetWidth * $height / $width)
    $resized = [Drawing.Bitmap]::new($targetWidth, $targetHeight, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $resizedGraphics = [Drawing.Graphics]::FromImage($resized)
    try {
      $resizedGraphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
      $resizedGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $resizedGraphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
      $resizedGraphics.DrawImage($bitmap, 0, 0, $targetWidth, $targetHeight)

      $codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
        Where-Object MimeType -eq 'image/jpeg' |
        Select-Object -First 1
      $encoderParameters = [Drawing.Imaging.EncoderParameters]::new(1)
      try {
        $quality = if ($Knowledge) { 86L } else { 84L }
        $encoderParameters.Param[0] = [Drawing.Imaging.EncoderParameter]::new(
          [Drawing.Imaging.Encoder]::Quality,
          $quality
        )
        $resized.Save((Join-Path $OutputDirectory $Name), $codec, $encoderParameters)
      } finally {
        $encoderParameters.Dispose()
      }
    } finally {
      $resizedGraphics.Dispose()
      $resized.Dispose()
    }
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$artworks = @(
  @{ Name = 'module-limiter.jpg'; Primary = '#007aff'; Secondary = '#32ade6'; Kind = 'limiter'; Knowledge = $false },
  @{ Name = 'module-spl.jpg'; Primary = '#5856d6'; Secondary = '#af52de'; Kind = 'spl'; Knowledge = $false },
  @{ Name = 'module-cable.jpg'; Primary = '#ff9f0a'; Secondary = '#ffcc00'; Kind = 'cable'; Knowledge = $false },
  @{ Name = 'module-venue.jpg'; Primary = '#34c759'; Secondary = '#30d1be'; Kind = 'venue'; Knowledge = $false },
  @{ Name = 'knowledge-limiter.jpg'; Primary = '#007aff'; Secondary = '#32ade6'; Kind = 'limiter'; Knowledge = $true },
  @{ Name = 'knowledge-distance.jpg'; Primary = '#5856d6'; Secondary = '#5ac8fa'; Kind = 'spl'; Knowledge = $true },
  @{ Name = 'knowledge-cable.jpg'; Primary = '#ff9f0a'; Secondary = '#ffcc00'; Kind = 'cable'; Knowledge = $true },
  @{ Name = 'knowledge-fill.jpg'; Primary = '#34c759'; Secondary = '#30d1be'; Kind = 'venue'; Knowledge = $true }
)

foreach ($artwork in $artworks) {
  New-HomeArtwork @artwork
}

$generatedPngNames = @(
  'module-limiter.png', 'module-spl.png', 'module-cable.png', 'module-venue.png',
  'knowledge-limiter.png', 'knowledge-distance.png', 'knowledge-cable.png', 'knowledge-fill.png'
)
foreach ($name in $generatedPngNames) {
  $oldPath = Join-Path $OutputDirectory $name
  if (Test-Path -LiteralPath $oldPath) { Remove-Item -LiteralPath $oldPath -Force }
}

Get-ChildItem -LiteralPath $OutputDirectory -Filter *.jpg |
  Sort-Object Name |
  Select-Object Name, Length
