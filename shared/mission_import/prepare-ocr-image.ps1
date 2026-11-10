param(
    [Parameter(Mandatory = $true)]
    [string]$Source,

    [Parameter(Mandatory = $true)]
    [string]$Output,

    [ValidateSet("Objectives", "Details", "Reward", "Title", "Balance", "BalanceContext", "BalanceWord")]
    [string]$Region = "Objectives",
    [int]$CropLeft = 0,
    [int]$CropTop = 0,
    [int]$CropWidth = 0,
    [int]$CropHeight = 0
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$sourceImage = [System.Drawing.Bitmap]::FromFile($Source)
try {
    if ($Region -eq "BalanceWord") {
        if ($CropLeft -lt 0 -or $CropTop -lt 0 -or $CropWidth -le 0 -or $CropHeight -le 0 -or
            $CropLeft + $CropWidth -gt $sourceImage.Width -or $CropTop + $CropHeight -gt $sourceImage.Height) {
            throw 'Invalid number rectangle'
        }
        $cropX = $CropLeft
        $cropY = $CropTop
    }
    elseif ($Region -eq "Balance") {
        # Separate the amount from the currency icon and the username below it.
        $cropX = [int]($sourceImage.Width * 0.282)
        $cropY = [int]($sourceImage.Height * 0.894)
        $cropWidth = [int]($sourceImage.Width * 0.074)
        $cropHeight = [int]($sourceImage.Height * 0.027)
    }
    elseif ($Region -eq "BalanceContext") {
        # The username has smaller lettering; a shared block with the amount
        # causes OCR to skip it. Read its own line instead.
        $cropX = [int]($sourceImage.Width * 0.280)
        $cropY = [int]($sourceImage.Height * 0.917)
        $cropWidth = [int]($sourceImage.Width * 0.081)
        $cropHeight = [int]($sourceImage.Height * 0.022)
    }
    elseif ($Region -eq "Details") {
        $cropX = [int]($sourceImage.Width * 0.385)
        $cropY = [int]($sourceImage.Height * 0.245)
        $cropWidth = [int]($sourceImage.Width * 0.215)
        $cropHeight = [int]($sourceImage.Height * 0.47)
    }
    elseif ($Region -eq "Reward") {
        $cropX = [int]($sourceImage.Width * 0.625)
        $cropY = [int]($sourceImage.Height * 0.155)
        $cropWidth = [int]($sourceImage.Width * 0.195)
        $cropHeight = [int]($sourceImage.Height * 0.105)
    }
    elseif ($Region -eq "Title") {
        $cropX = [int]($sourceImage.Width * 0.385)
        $cropY = [int]($sourceImage.Height * 0.155)
        $cropWidth = [int]($sourceImage.Width * 0.235)
        $cropHeight = [int]($sourceImage.Height * 0.105)
    }
    else {
        $cropX = [int]($sourceImage.Width * 0.587)
        $cropY = [int]($sourceImage.Height * 0.25)
        $cropWidth = [int]($sourceImage.Width * 0.26)
        $cropHeight = [int]($sourceImage.Height * 0.38)
    }
    $cropWidth = [Math]::Min($cropWidth, $sourceImage.Width - $cropX)
    $cropHeight = [Math]::Min($cropHeight, $sourceImage.Height - $cropY)

    $scale = if ($Region -eq 'BalanceWord') { 1 } elseif ($Region -like 'Balance*') { 3 } else { 2 }
    $padding = if ($Region -like 'Balance*') { 24 } else { 0 }
    $targetImage = New-Object System.Drawing.Bitmap ($cropWidth * $scale + 2 * $padding), ($cropHeight * $scale + 2 * $padding)
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($targetImage)
        $attributes = New-Object System.Drawing.Imaging.ImageAttributes
        try {
            if ($Region -like 'Balance*') {
                $graphics.Clear([System.Drawing.Color]::White)
                if ($Region -ne 'BalanceWord') {
                    # Dark HUD background and white lettering become a clean,
                    # high-contrast grayscale image for the small footer text.
                    $matrix = New-Object System.Drawing.Imaging.ColorMatrix
                    $matrix.Matrix00 = $matrix.Matrix01 = $matrix.Matrix02 = -1
                    $matrix.Matrix10 = $matrix.Matrix11 = $matrix.Matrix12 = -1
                    $matrix.Matrix20 = $matrix.Matrix21 = $matrix.Matrix22 = -1
                    $matrix.Matrix40 = $matrix.Matrix41 = $matrix.Matrix42 = 3
                    $attributes.SetColorMatrix($matrix)
                }
            }
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.DrawImage(
                $sourceImage,
                (New-Object System.Drawing.Rectangle $padding, $padding, ($cropWidth * $scale), ($cropHeight * $scale)),
                $cropX, $cropY, $cropWidth, $cropHeight,
                [System.Drawing.GraphicsUnit]::Pixel, $attributes
            )
        }
        finally {
            $attributes.Dispose()
            $graphics.Dispose()
        }
        $targetImage.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $targetImage.Dispose()
    }
}
finally {
    $sourceImage.Dispose()
}
