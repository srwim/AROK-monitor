; AROK Monitor — Inno Setup script
; Build the exe first (make_installer.bat does both steps).
#define AppName "AROK Monitor"
#define AppVersion "1.6.3"
#define AppVersionDisplay "v1.6.3"
#define AppPublisher "arok.ai"
#define AppExe "AROK.exe"

[Setup]
AppId={{8B1F2C3D-AROK-4MON-9ITR-DEMO31000001}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL=https://arok.ai
DefaultDirName={autopf}\AROK Monitor
DefaultGroupName=AROK Monitor
DisableProgramGroupPage=yes
OutputDir=installer_out
OutputBaseFilename=AROK-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=branding\icon.ico
WizardImageFile=branding\wizard-large.bmp
WizardSmallImageFile=branding\wizard-small.bmp
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
; Auto-update support: the app downloads the new installer and runs it
; /VERYSILENT; these make in-use files close cleanly during that update.
CloseApplications=yes
CloseApplicationsFilter=AROK.exe
SetupMutex=AROKSetupMutex

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "backend\dist\AROK\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "branding\icon.ico"; DestDir: "{app}"

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\icon.ico"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon; IconFilename: "{app}\icon.ico"

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[Code]
{ Leave-no-trace uninstall: AROK keeps user data in LOCALAPPDATA\AROK
  (monitoring history + settings + license in arok.db, desktop.log, and
  the downloaded AI model in models\). The uninstaller asks per item. }

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir, ModelsDir: string;
begin
  if CurUninstallStep = usUninstall then
  begin
    DataDir := ExpandConstant('{localappdata}\AROK');
    ModelsDir := DataDir + '\models';

    if DirExists(ModelsDir) then
    begin
      if MsgBox('Remove the downloaded local AI model?' + #13#10 +
                '(frees up to ~1.7 GB; you would need to download it again after a reinstall)',
                mbConfirmation, MB_YESNO) = IDYES then
        DelTree(ModelsDir, True, True, True);
    end;

    if DirExists(DataDir) then
    begin
      if MsgBox('Remove all monitoring data and logs?' + #13#10 +
                'This deletes metric history, alerts, settings, desktop.log' + #13#10 +
                'AND your license activation - leaving no trace of AROK on this PC.',
                mbConfirmation, MB_YESNO) = IDYES then
      begin
        DeleteFile(DataDir + '\arok.db');
        DeleteFile(DataDir + '\desktop.log');
        DelTree(DataDir + '\__pycache__', True, True, True);
      end;
      { remove the AROK folder itself if nothing was kept }
      RemoveDir(DataDir);
    end;
  end;
end;
