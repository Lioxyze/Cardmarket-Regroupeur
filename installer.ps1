# Regroupeur pour Cardmarket - installation (a faire une seule fois).
# 1. Installe l'extension dans %LOCALAPPDATA%\Regroupeur-pour-Cardmarket\extension
# 2. Cree une tache planifiee (sans droits administrateur) qui installe les nouvelles versions toute seule
# 3. Explique la derniere etape dans Chrome : « Charger l'extension non empaquetee »
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Regroupeur-pour-Cardmarket'),
  [string]$BaseUrl = 'https://raw.githubusercontent.com/Lioxyze/Cardmarket-Regroupeur/diffusion',
  [switch]$NoTask,
  [switch]$NoPause,
  [switch]$NoBrowser   # tests : ni presse-papiers, ni ouverture de Chrome
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$TaskName = 'Regroupeur pour Cardmarket - mise a jour'
$ExtDir = Join-Path $InstallDir 'extension'
$Updater = Join-Path $InstallDir 'mise-a-jour.ps1'

function Step([string]$Text) { Write-Host ''; Write-Host $Text -ForegroundColor Cyan }

try {
  Write-Host ''
  Write-Host '  Regroupeur pour Cardmarket - installation' -ForegroundColor White
  Write-Host '  -----------------------------------------'

  Step '1/3  Telechargement de l''extension...'
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  foreach ($name in @('mise-a-jour.ps1', 'desinstaller.ps1')) {
    Invoke-WebRequest -Uri "$BaseUrl/$name" -OutFile (Join-Path $InstallDir $name) -UseBasicParsing -TimeoutSec 60
  }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Updater -InstallDir $InstallDir -VersionUrl "$BaseUrl/version.json" -Force
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $ExtDir 'manifest.json'))) {
    throw "Le telechargement a echoue (voir $InstallDir\mise-a-jour.log)."
  }
  $version = (Get-Content -Path (Join-Path $ExtDir 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
  Write-Host "     Version $version installee dans $ExtDir"

  Step '2/3  Mises a jour automatiques...'
  if ($NoTask) {
    Write-Host '     (ignore : option -NoTask)'
  }
  else {
    # conhost --headless : aucune fenetre ne s'ouvre quand la verification tourne.
    $arguments = "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$Updater`" -InstallDir `"$InstallDir`""
    $action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument $arguments
    $repeat = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(10)) -RepetitionInterval (New-TimeSpan -Hours 3) -RepetitionDuration (New-TimeSpan -Days 3650)
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -Hidden
    $user = "$env:USERDOMAIN\$env:USERNAME"
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    try {
      # Toutes les 3 heures + a chaque ouverture de session
      $logon = New-ScheduledTaskTrigger -AtLogOn -User $user
      Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($repeat, $logon) -Settings $settings -Principal $principal -Force | Out-Null
    }
    catch {
      # Certains PC refusent le declencheur « ouverture de session » sans droits administrateur.
      Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $repeat -Settings $settings -Principal $principal -Force | Out-Null
    }
    Write-Host '     Verification des nouvelles versions toutes les 3 heures : activee.'
  }

  Step '3/3  Derniere etape, dans Chrome (une seule fois) :'
  if (-not $NoBrowser) { try { Set-Clipboard -Value $ExtDir } catch { } }
  Write-Host '     a. Ouvre l''adresse  chrome://extensions'
  Write-Host '     b. Active « Mode developpeur » (en haut a droite)'
  Write-Host '     c. Clique « Charger l''extension non empaquetee »'
  Write-Host "     d. Choisis le dossier : $ExtDir"
  Write-Host '        (son chemin est deja copie : colle-le avec Ctrl+V dans la barre d''adresse de la fenetre)'
  Write-Host ''
  Write-Host '  Ensuite, les mises a jour arrivent toutes seules : le Regroupeur affiche'
  Write-Host '  « Mise a jour prete > Activer maintenant » quand une nouvelle version est installee.'
  Write-Host '  Laisse le « Mode developpeur » active, sinon Chrome desactive l''extension.'
  Write-Host ''
  if (-not $NoBrowser) { try { Start-Process 'chrome.exe' 'chrome://extensions' } catch { } }
}
catch {
  Write-Host ''
  Write-Host ('  Installation impossible : ' + $_.Exception.Message) -ForegroundColor Red
}

if (-not $NoPause) { Read-Host '  Appuie sur Entree pour fermer' | Out-Null }
