param(
    [Parameter(Mandatory = $true)]
    [string]$Source,

    [Parameter(Mandatory = $true)]
    [string]$Output,

    [ValidateSet("Objectives", "Details", "Reward", "Title")]
    [string]$Region = "Objectives"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$sourceImage = [System.Drawing.Bitmap]::FromFile($Source)
try {
    if ($Region -eq "Details") {
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

    $targetImage = New-Object System.Drawing.Bitmap ($cropWidth * 2), ($cropHeight * 2)
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($targetImage)
        try {
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.DrawImage(
                $sourceImage,
                (New-Object System.Drawing.Rectangle 0, 0, $targetImage.Width, $targetImage.Height),
                (New-Object System.Drawing.Rectangle $cropX, $cropY, $cropWidth, $cropHeight),
                [System.Drawing.GraphicsUnit]::Pixel
            )
        }
        finally {
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
