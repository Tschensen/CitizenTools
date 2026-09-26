#ifndef AppVersion
  #define AppVersion "0.1.25"
#endif
[Setup]
AppId={{096EB0A4-E06C-4D53-BA74-BFC2D465FEC0}
AppName=Citizen Tools Solo
AppVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\CitizenTools-Solo
DefaultGroupName=Citizen Tools Solo
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputBaseFilename=CitizenTools-Solo-Setup
Compression=lzma2
SolidCompression=yes
SetupIconFile={#SourceDir}\_internal\companion\assets\citizen-tools.ico
UninstallDisplayIcon={app}\CitizenTools-Solo.exe
WizardStyle=modern
CloseApplications=yes

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Desktop-Verknüpfung / Desktop shortcut"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "prerequisites\*"
#if FileExists(SourceDir + "\prerequisites\MicrosoftEdgeWebView2RuntimeInstallerX64.exe")
Source: "{#SourceDir}\prerequisites\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: NeedsWebView
#endif

[Icons]
Name: "{group}\Citizen Tools Solo"; Filename: "{app}\CitizenTools-Solo.exe"
Name: "{group}\Anleitung"; Filename: "{app}\README.md"
Name: "{autodesktop}\Citizen Tools Solo"; Filename: "{app}\CitizenTools-Solo.exe"; Tasks: desktopicon

[Run]
#if FileExists(SourceDir + "\prerequisites\MicrosoftEdgeWebView2RuntimeInstallerX64.exe")
Filename: "{tmp}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; Parameters: "/silent /install"; StatusMsg: "Microsoft WebView2 wird eingerichtet ..."; Flags: waituntilterminated; Check: NeedsWebView
#endif
Filename: "{app}\CitizenTools-Solo.exe"; Description: "Citizen Tools Solo starten"; Flags: nowait postinstall skipifsilent

[Code]
function NeedsWebView: Boolean;
var Version: String;
begin
  Result := not ((RegQueryStringValue(HKLM32, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or (RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')));
end;
