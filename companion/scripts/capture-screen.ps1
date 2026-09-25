param(
    [Parameter(Mandatory = $true)]
    [string]$Output,

    [ValidateSet("ActiveMonitor", "VirtualDesktop")]
    [string]$Mode = "ActiveMonitor"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class CitizenToolsCaptureNative {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
}
"@

[CitizenToolsCaptureNative]::SetProcessDPIAware() | Out-Null
if ($Mode -eq "VirtualDesktop") {
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
}
else {
    $foregroundWindow = [CitizenToolsCaptureNative]::GetForegroundWindow()
    $bounds = [System.Windows.Forms.Screen]::FromHandle($foregroundWindow).Bounds
}

$targetFolder = Split-Path -Parent $Output
if ($targetFolder) {
    [System.IO.Directory]::CreateDirectory($targetFolder) | Out-Null
}

$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen(
            $bounds.Left,
            $bounds.Top,
            0,
            0,
            $bounds.Size,
            [System.Drawing.CopyPixelOperation]::SourceCopy
        )
    }
    finally {
        $graphics.Dispose()
    }
    $bitmap.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
    $bitmap.Dispose()
}
